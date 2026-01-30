import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests


BASE_URL = "https://iss.moex.com/iss"
OUT_PATH = "data/ytm_top20.json"

TOP_N = 20
MAX_YEARS = 2.0
LISTLEVEL_TARGET = 1  # для сайта сейчас делаем карту по уровню 1


SITE_COLS = [
    "SECID",
    "SHORTNAME",
    "MATDATE",
    "YEARS",
    "YTM",
    "COUPONPERCENT",
    "LISTLEVEL",
    "ISSUESIZE_FMT",
    "FACEVALUEONSETTLEDATE",
    "CURRENCYID",
    "UPDATETIME",
]


def _as_df(js: dict, block: str) -> pd.DataFrame:
    if block not in js or not js[block].get("data"):
        return pd.DataFrame()
    return pd.DataFrame(js[block]["data"], columns=js[block]["columns"])


def fetch_traded_bonds(limit: int = 2000) -> pd.DataFrame:
    """
    Аналог твоего get_traded_bonds_with_times(), но:
    - тянем ВСЕ страницы (start)
    - забираем и securities, и marketdata, и marketdata_yields (чтобы точно были YIELDATPREVWAPRICE и UPDATETIME)
    """
    url = f"{BASE_URL}/engines/stock/markets/bonds/securities.json"

    sec_chunks = []
    md_chunks = []
    mdy_chunks = []

    start = 0
    while True:
        params = {
            "is_trading": 1,
            "iss.meta": "off",
            "limit": limit,
            "start": start,
        }
        r = requests.get(url, params=params, timeout=40)
        r.raise_for_status()
        js = r.json()

        sec = _as_df(js, "securities")
        md = _as_df(js, "marketdata")
        mdy = _as_df(js, "marketdata_yields")

        if not sec.empty:
            sec_chunks.append(sec)
        if not md.empty:
            md_chunks.append(md)
        if not mdy.empty:
            mdy_chunks.append(mdy)

        n = 0 if sec.empty else len(sec)
        if n < limit:
            break
        start += limit

    sec_all = pd.concat(sec_chunks, ignore_index=True) if sec_chunks else pd.DataFrame()
    md_all = pd.concat(md_chunks, ignore_index=True) if md_chunks else pd.DataFrame()
    mdy_all = pd.concat(mdy_chunks, ignore_index=True) if mdy_chunks else pd.DataFrame()

    # merge blocks by SECID
    out = sec_all.copy()

    if not md_all.empty and "SECID" in md_all.columns and "SECID" in out.columns:
        out = out.merge(md_all, on="SECID", how="left", suffixes=("", "_MD"))

    if not mdy_all.empty and "SECID" in mdy_all.columns and "SECID" in out.columns:
        out = out.merge(mdy_all, on="SECID", how="left", suffixes=("", "_YLD"))

    out["FETCH_TIME_UTC"] = pd.Timestamp.utcnow()
    return out


def pick_col(df: pd.DataFrame, candidates: list[str]) -> str | None:
    for c in candidates:
        if c in df.columns:
            return c
    return None


def build_filtered_level(df_raw: pd.DataFrame) -> pd.DataFrame:
    df = df_raw.copy()

    # MATDATE
    if "MATDATE" in df.columns:
        df["MATDATE"] = pd.to_datetime(df["MATDATE"], errors="coerce")

    # YTM from MOEX (your notebook used YIELDATPREVWAPRICE)
    ytm_col = pick_col(df, ["YIELDATPREVWAPRICE", "YIELDATPREVWAPRICE_YLD", "YIELDATPREVWAPRICE_MD"])
    if ytm_col is None:
        raise RuntimeError("Cannot find YIELDATPREVWAPRICE in MOEX response")

    df["YTM"] = pd.to_numeric(df[ytm_col], errors="coerce")

    # required
    if "LISTLEVEL" in df.columns:
        df["LISTLEVEL"] = pd.to_numeric(df["LISTLEVEL"], errors="coerce")
    df = df.dropna(subset=["MATDATE", "YTM", "LISTLEVEL"])
    df = df[df["YTM"] > 0]

    # exclude today maturity
    today = pd.Timestamp.today().normalize()
    df = df[df["MATDATE"] != today]

    # issuesize fmt
    if "ISSUESIZE" in df.columns:
        df["ISSUESIZE"] = pd.to_numeric(df["ISSUESIZE"], errors="coerce")
        df["ISSUESIZE_FMT"] = df["ISSUESIZE"].apply(lambda x: f"{int(x):,}" if pd.notna(x) else None)
    else:
        df["ISSUESIZE_FMT"] = None

    # currency
    if "CURRENCYID" in df.columns:
        df["CURRENCYID"] = df["CURRENCYID"].replace({"SUR": "RUB"})
    else:
        df["CURRENCYID"] = None

    # YEARS
    df["YEARS"] = (df["MATDATE"] - pd.Timestamp.today()).dt.days / 365.25
    df = df[df["YEARS"] > 0]

    # Only RUB like in your notebook
    df = df[df["CURRENCYID"] == "RUB"].copy()

    # fixed coupon (как у тебя)
    for c in ["COUPONPERCENT", "COUPONPERIOD"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce")

    fixed_mask = (
        df.get("COUPONPERCENT", pd.Series([np.nan]*len(df))).notna() &
        (df.get("COUPONPERCENT", pd.Series([0]*len(df))) > 0) &
        df.get("COUPONPERIOD", pd.Series([np.nan]*len(df))).notna() &
        (df.get("COUPONPERIOD", pd.Series([0]*len(df))) > 0)
    )

    # exclude floaters/indexed (как у тебя)
    text_cols = (
        df.get("BONDTYPE", "").astype(str) + " " +
        df.get("BONDSUBTYPE", "").astype(str) + " " +
        df.get("REMARKS", "").astype(str)
    ).str.upper()

    exclude_keywords = (
        text_cols.str.contains("FLOAT", na=False) |
        text_cols.str.contains("FRN", na=False) |
        text_cols.str.contains("ИНДЕКС", na=False) |
        text_cols.str.contains("ИНФЛЯЦ", na=False) |
        text_cols.str.contains("RUONIA", na=False)
    )

    # final filters
    out = df[
        (df["LISTLEVEL"] == LISTLEVEL_TARGET) &
        (df["YEARS"] <= MAX_YEARS) &
        fixed_mask &
        (~exclude_keywords) &
        df["YTM"].notna()
    ].copy()

    out = out.sort_values("YTM", ascending=False).reset_index(drop=True)

    # ensure UPDATETIME exists: try to pick from possible columns
    updt_col = pick_col(out, ["UPDATETIME", "UPDATETIME_YLD", "UPDATETIME_MD", "SYSTIME", "SYSTIME_YLD"])
    if updt_col and updt_col != "UPDATETIME":
        out["UPDATETIME"] = out[updt_col]
    if "UPDATETIME" not in out.columns:
        out["UPDATETIME"] = None

    return out


def write_site_json(df: pd.DataFrame, out_path: str = OUT_PATH):
    if df is None or len(df) == 0:
        payload = {
            "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
            "cols": SITE_COLS,
            "rows": []
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        print(f"No rows. Wrote empty {out_path}")
        return

    top = df.head(TOP_N).copy()

    # sizes/colors for treemap (based on YTM like you wanted)
    top["SIZE"] = np.sqrt(pd.to_numeric(top["YTM"], errors="coerce").clip(lower=0))
    ytm = pd.to_numeric(top["YTM"], errors="coerce").to_numpy()
    p5, p95 = np.percentile(ytm, 5), np.percentile(ytm, 95)
    top["COLORVAL"] = pd.to_numeric(top["YTM"], errors="coerce").clip(p5, p95)

    cols_present = [c for c in SITE_COLS if c in top.columns]

    rows = []
    for _, r in top.iterrows():
        item = {}
        for c in cols_present:
            v = r[c]
            if pd.isna(v):
                item[c] = None
            else:
                item[c] = str(v) if c in ("SECID", "MATDATE", "UPDATETIME") else v

        item["SIZE"] = float(r["SIZE"]) if pd.notna(r["SIZE"]) else 0.0
        item["COLORVAL"] = float(r["COLORVAL"]) if pd.notna(r["COLORVAL"]) else 0.0
        rows.append(item)

    payload = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "cols": cols_present,
        "rows": rows
    }

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f"Wrote {out_path} ({len(rows)} rows)")


def main():
    bonds = fetch_traded_bonds(limit=2000)
    level = build_filtered_level(bonds)
    write_site_json(level, OUT_PATH)


if __name__ == "__main__":
    main()
