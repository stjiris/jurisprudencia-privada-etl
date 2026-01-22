#!/usr/bin/env python3
import sys
import tempfile
import os
import warnings
from cryptography.utils import CryptographyDeprecationWarning

warnings.filterwarnings("ignore", category=CryptographyDeprecationWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

import camelot
import pandas as pd

pdf_bytes = sys.stdin.buffer.read()
if not pdf_bytes:
    sys.exit(1)

tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
tmp_path = tmp.name
tmp.write(pdf_bytes)
tmp.close()

def dedupe(cols):
    seen = {}
    new_cols = []
    for c in cols:
        if c in seen:
            seen[c] += 1
            new_cols.append(f"{c}_{seen[c]}")
        else:
            seen[c] = 0
            new_cols.append(c)
    return new_cols

all_dfs = []

try:
    tables = camelot.read_pdf(tmp_path, pages='1-end')
    if not tables:
        raise ValueError("No tables found in PDF")

    for t in tables:
        df = t.df.copy()
        cols = df.iloc[0].astype(str).str.replace('\n',' ',regex=False).str.strip().tolist()
        df.columns = dedupe(cols)
        df = df[1:].reset_index(drop=True).astype(str)
        all_dfs.append(df)

    final_df = pd.concat(all_dfs, ignore_index=True)
    str_cols = final_df.select_dtypes(include="object").columns
    for c in str_cols:
        final_df[c] = final_df[c].str.replace('\n', ' ', regex=False)
        final_df[c] = final_df[c].str.replace(r'\s+', ' ', regex=True).str.strip()        
    print(final_df.to_json(orient="records", force_ascii=False))
finally:
    os.unlink(tmp_path)
