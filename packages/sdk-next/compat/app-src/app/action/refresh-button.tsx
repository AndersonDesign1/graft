"use client";

import { useState } from "react";
import { refreshHome } from "../actions";

export function RefreshButton() {
  const [result, setResult] = useState("");
  return (
    <>
      <button type="button" onClick={async () => setResult(JSON.stringify(await refreshHome()))}>
        Refresh home
      </button>
      <output id="result">{result}</output>
    </>
  );
}
