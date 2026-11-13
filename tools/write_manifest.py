#!/usr/bin/env python3
"""Write data/models.json listing every built model (read by the web app at start-up)."""
import json
from pathlib import Path

data = Path(__file__).resolve().parent.parent / "data"
order = {"human-gem": 0, "mouse-gem": 1}
models = []
for d in sorted(data.iterdir(), key=lambda p: (order.get(p.name, 9), p.name)):
    need = ["model.json", "structures.json", "atommaps.json", "layout.json"]
    if d.is_dir() and all((d / f).exists() for f in need):
        meta = json.loads((d / "model.json").read_text())["meta"]
        pretty = "-".join(w.upper() if w == "gem" else w.capitalize() for w in d.name.split("-"))
        models.append({"slug": d.name, "name": pretty, "version": meta.get("version", ""),
                       "description": meta.get("name", "")})
(data / "models.json").write_text(json.dumps(models, indent=1))
print("models:", [m["slug"] for m in models])
