# Macro data

`createMacroService()` collects twenty fixed FRED series through the public CSV graph download endpoint. No API key is required. The application never accepts an arbitrary series URL. Three concurrent requests, 12-second request deadlines, 1.5 MB response limits, a six-year source window and an 18-second snapshot deadline and shared five-minute snapshot caching bound resource use. Responses with unexpected headers are rejected. Missing observations remain missing. Prior successfully collected values retain their original collection date and show stale status after an upstream failure.

The market workspace displays values, units, observation dates, historical paths and direct series provenance. Monthly and quarterly inflation/growth metrics use an exact corresponding month in the preceding year. A monthly or quarterly release is not assigned today's date. Fed balance-sheet millions are converted to USD trillions. Macroeconomic percentages and indices retain their native units; they are not currency converted.

| Series | Measurement |
| --- | --- |
| [CPIAUCSL](https://fred.stlouisfed.org/series/CPIAUCSL) | US CPI, computed year-over-year |
| [PCEPILFE](https://fred.stlouisfed.org/series/PCEPILFE) | US core PCE index, computed year-over-year |
| [CP0000EZ19M086NEST](https://fred.stlouisfed.org/series/CP0000EZ19M086NEST) | Euro-area HICP index, computed year-over-year |
| [FEDFUNDS](https://fred.stlouisfed.org/series/FEDFUNDS) | Effective federal funds rate, monthly |
| [ECBDFR](https://fred.stlouisfed.org/series/ECBDFR) | ECB deposit facility rate |
| [DGS2](https://fred.stlouisfed.org/series/DGS2) | US Treasury 2-year yield |
| [DGS10](https://fred.stlouisfed.org/series/DGS10) | US Treasury 10-year yield |
| [T10Y2Y](https://fred.stlouisfed.org/series/T10Y2Y) | 10-year minus 2-year Treasury spread |
| [UNRATE](https://fred.stlouisfed.org/series/UNRATE) | US civilian unemployment rate |
| [GDPC1](https://fred.stlouisfed.org/series/GDPC1) | Real US GDP, computed year-over-year |
| [M2SL](https://fred.stlouisfed.org/series/M2SL) | US M2 money stock, computed year-over-year |
| [WALCL](https://fred.stlouisfed.org/series/WALCL) | Federal Reserve total assets |
| [DRTSCILM](https://fred.stlouisfed.org/series/DRTSCILM) | Net share of banks tightening large/middle-market business lending standards |
| [DCOILBRENTEU](https://fred.stlouisfed.org/series/DCOILBRENTEU) | Brent spot crude price, USD/barrel |
| [DTWEXBGS](https://fred.stlouisfed.org/series/DTWEXBGS) | Broad trade-weighted US dollar index |

Source documentation: [FRED downloads](https://fred.stlouisfed.org/help/data/downloading/using-the-download-data-link), [FRED API overview](https://fred.stlouisfed.org/docs/api/fred/overview.html). Series links expose source agencies, adjustments, units and release schedules. The service supplies `getMacroEvidence()` source records for AI research; stale observations remain marked stale in those records. Current revised histories are not point-in-time vintages or historical backtest inputs.

Additional risk coverage: [VIXCLS](https://fred.stlouisfed.org/series/VIXCLS) (CBOE volatility index), [BAMLH0A0HYM2](https://fred.stlouisfed.org/series/BAMLH0A0HYM2) (ICE BofA high-yield spread, percent), [NFCI](https://fred.stlouisfed.org/series/NFCI) (Chicago Fed conditions index). International inflation uses World Bank annual series [FPCPITOTLZGJPN](https://fred.stlouisfed.org/series/FPCPITOTLZGJPN) and [FPCPITOTLZGGBR](https://fred.stlouisfed.org/series/FPCPITOTLZGGBR), explicitly labeled annual with observation dates. Older OECD monthly series have discontinued coverage, so they are not substituted for current monthly inflation. Annual percentage series pass through without applying a second YoY transform.
