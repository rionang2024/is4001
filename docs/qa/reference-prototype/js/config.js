// Everything that depends on Person 1's data contract lives here.
// If a column or category label is renamed, change it here only.
window.QA_CONFIG = {
  files: {
    summary: "data/dashboard/summary.csv",
    profile: "data/dashboard/profile.csv",
    dowHour: "data/dashboard/dow_hour.csv",
    monthly: "data/dashboard/monthly.csv",
    nightly: "data/dashboard/nightly.csv",
    units: "data/dashboard/units.csv",
  },

  // internal key -> CSV column name
  cols: {
    year: "Year",
    floor: "Floor",
    zone: "Zone",
    endUse: "End_Use",
    unit: "Unit",
    dayType: "Day_Type",
    weekPart: "Week_Part",
    month: "Month",
    date: "Date",
    hour: "Hour",
    dow: "DOW",
    actual: "Actual_kW",
    meanKw: "Mean_kW",
    baseline: "Daytime_Baseline_kW",
    ratio: "After_Hours_Ratio",
    nightRatio: "Ratio",
    benchLow: "Benchmark_Low",
    benchHigh: "Benchmark_High",
    excess: "Excess_kW",
    excessKwh: "Excess_kWh_per_year",
    anomaly: "Is_Anomaly",
    priority: "Priority",
    coverage: "Coverage_Pct",
    share: "Share_Pct",
    status: "Data_Status",
  },

  // Columns each file must have (internal keys). Checked on load.
  required: {
    summary: ["year", "floor", "zone", "endUse", "dayType", "actual", "baseline", "ratio",
              "benchLow", "benchHigh", "excess", "excessKwh", "anomaly", "priority", "coverage", "status"],
    profile: ["year", "floor", "zone", "endUse", "weekPart", "hour", "meanKw"],
    dowHour: ["year", "floor", "zone", "endUse", "dow", "hour", "meanKw"],
    monthly: ["year", "floor", "zone", "endUse", "month", "dayType", "meanKw", "ratio", "coverage", "status"],
    nightly: ["year", "floor", "date", "dayType", "meanKw", "nightRatio"],
    units: ["year", "floor", "zone", "unit", "dayType", "meanKw", "share"],
  },

  labels: {
    daytime: "Weekday Daytime",
    afterHours: "Weekday After-Hours",
    weekend: "Weekend",
    allDayTypes: "All",
    all: "All",              // Zone = All and End_Use = All mean "whole floor"
    ok: "OK",
    insufficient: "Insufficient data",
  },

  // Short names shown on charts
  display: {
    "Weekday Daytime": "Weekday day",
    "Weekday After-Hours": "Weekday night",
    "Weekend": "Weekend",
    AC: "AC",
    Light: "Lighting",
    Plug: "Plug load",
  },

  endUses: ["AC", "Light", "Plug"],
  ratioCap: 2,           // colour scales stop at 2x daytime so one extreme cell can't wash out the rest
  officeHours: [8, 17],  // daytime = 08:00 to 16:59
};
