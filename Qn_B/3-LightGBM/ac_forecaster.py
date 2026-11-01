import json
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd


class ACLoadForecaster:
    def __init__(self, booster, features, zone_categories, zone_map, metadata=None):
        self.booster = booster
        self.features = list(features)
        self.zone_categories = list(zone_categories)      # zone_code categories used in training
        self.zone_map = dict(zone_map)                    # e.g. {"F3_Z1": 4}
        self.metadata = metadata or {}

    # ------------------------------------------------------------------ build / save / load
    @classmethod
    def from_model(cls, model, features, data, metadata=None):
        """model: fitted LGBMRegressor or Booster; data: a frame with zone_id + zone_code."""
        booster = model.booster_ if hasattr(model, "booster_") else model
        codes = data["zone_code"].astype("category").cat.categories
        zone_map = (data[["zone_id", "zone_code"]].drop_duplicates()
                    .assign(zone_code=lambda d: d.zone_code.astype(int))
                    .set_index("zone_id")["zone_code"].to_dict())
        return cls(booster, features, [int(c) for c in codes], zone_map, metadata)

    def save(self, folder):
        folder = Path(folder)
        folder.mkdir(parents=True, exist_ok=True)
        self.booster.save_model(str(folder / "model.txt"))
        meta = {"features": self.features, "zone_categories": self.zone_categories,
                "zone_map": self.zone_map, "metadata": self.metadata}
        (folder / "meta.json").write_text(json.dumps(meta, indent=2, default=str))
        return folder

    @classmethod
    def load(cls, folder):
        folder = Path(folder)
        meta = json.loads((folder / "meta.json").read_text())
        booster = lgb.Booster(model_file=str(folder / "model.txt"))
        return cls(booster, meta["features"], meta["zone_categories"], meta["zone_map"],
                   meta.get("metadata"))

    # ------------------------------------------------------------------ predict
    def _prepare(self, df):
        X = pd.DataFrame(df).copy()
        if "zone_code" not in X and "zone_id" in X:          # allow zone_id as input
            X["zone_code"] = X["zone_id"].map(self.zone_map)
        missing = [c for c in self.features if c not in X]
        if missing:
            raise ValueError(f"missing input columns: {missing}")
        X["zone_code"] = pd.Categorical(X["zone_code"].astype(int), categories=self.zone_categories)
        return X[self.features]

    def predict(self, df):
        """Predicted AC load in kW (never negative)."""
        return np.clip(self.booster.predict(self._prepare(df)), 0, None)

    def predict_frame(self, df):
        return pd.DataFrame(df).assign(ac_load_kw_pred=self.predict(df))

    def predict_one(self, row: dict):
        return float(self.predict(pd.DataFrame([row]))[0])

    def explain(self, df):
        """SHAP contribution of each feature to each prediction (kW). 'base' = average prediction."""
        contrib = self.booster.predict(self._prepare(df), pred_contrib=True)
        return pd.DataFrame(contrib, columns=self.features + ["base"], index=pd.DataFrame(df).index)

    def __repr__(self):
        return (f"ACLoadForecaster({len(self.features)} features, {len(self.zone_map)} zones, "
                f"{self.booster.num_trees()} trees)")