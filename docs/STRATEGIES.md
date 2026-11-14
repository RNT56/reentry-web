# Strategy laboratory

`GET /api/strategies?symbol=INTC&currency=EUR&capital=10000&fee=1&bps=0` requires an authenticated account. It requests five years of sampled history, including historical FX when available. The returned `currency` is authoritative; unavailable conversion never changes the denomination label. Nothing is saved or executed at a broker.

All four account paths begin with the same cash budget. Fifty-two observations form the warmup; the remaining observed calendar months determine equal accumulation tranches. Lump sum buys at the first evaluation close; DCA buys a tranche on the first sample each month. Conditional strategies may leave cash uninvested. Cash earns zero interest. Each purchase includes the fixed fee and proportional spread. The chart includes cash, marks shares at each sample, and computes drawdown from the running account high. Returns are before tax, dividends and other cash distributions; price-history adjustments depend on the upstream provider. This is a historical accumulation comparison, not an execution-grade total-return backtest.

Power law fits `log(price) = intercept + exponent * log(1 + elapsed days)` with the first available observation as time origin. At each monthly decision it uses only previous samples and buys if the prior close is below its fitted trend. The live fit reports its in-window R². This is an empirical window fit applicable to any supplied positive price series, not a claim that every asset obeys Bitcoin's proposed long-run power law. Its origin, sample and window affect the result; no probability or long-term intrinsic value is inferred.

Elliott scanning uses strict local extrema confirmed two observations later. A candidate low-high-low setup must retrace 38.2–78.6% of the preceding upswing and hold above its starting low. Monthly accumulation occurs only when that candidate exists in earlier data; fills use the next available sampled close. Conditional wave-three levels are 1× and 1.618× the preceding impulse above the retracement low. This is explicitly a wave-two heuristic, not an exhaustive five-wave labeling engine or validated predictive model. Future price changes cannot alter already executed signals. No pivot is treated as known at its original occurrence time.

Methodology sits behind the on-demand Method & data control. Main surfaces show capital paths, actual historical returns, cash, fees, orders, drawdown and measured fit/setup values. The asset-structure plot contains up to 260 observed samples, the descriptive observed-window fitted power curve, confirmed high/low pivots, and conditional wave-three extensions when a setup is active. Extensions occupy an untimed comparison area, avoiding an invented future deadline. Parameters stay behind a compact disclosure.

Sources:

- [SEC Investor.gov: Dollar Cost Averaging](https://www.investor.gov/introduction-investing/investing-basics/glossary/dollar-cost-averaging)
- [Vanguard: Cost averaging research](https://corporate.vanguard.com/content/dam/corp/research/pdf/cost_averaging_invest_now_or_temporarily_hold_your_cash.pdf)
- [Penn State: Regression transformations](https://online.stat.psu.edu/stat501/Lesson09)
- [Elliott Wave International: wave rules](https://www.elliottwave.com/wave-riffs/questions-we-get-questions/)
