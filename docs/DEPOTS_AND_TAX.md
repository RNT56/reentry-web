# Depot choices and German tax defaults

The depot field is a manual record label. It never connects to a broker or imports account data. `src/domain/depots.js` provides the shared display catalog. Bounded imported depot names remain valid and appear as an additional current choice, so renaming a provider never rewrites holdings or completed trades.

The catalog includes Trade Republic, Consorsbank, ING, comdirect, DKB, Scalable Capital, flatex, Finanzen invest (formerly ZERO), SMARTBROKER+, S Broker, Sparkasse, Commerzbank, maxblue, Interactive Brokers, and Other.

Verified against primary provider pages on 14 November 2026:

- [ING](https://www.ing.de/sparen-anlegen/direkt-depot/)
- [comdirect](https://www.comdirect.de/depot/comdirect-depot.html)
- [DKB](https://www.dkb.de/privatkunden/investieren/depot)
- [Scalable Capital](https://de.scalable.capital/trading)
- [flatex](https://www.flatex.de/depot/)
- [Finanzen invest naming and continuity](https://www.finanzen.net/ratgeber/allgemein/fakten-zu-finanzen-invest/)
- [SMARTBROKER+](https://www.smartbrokerplus.de/de-de/kundenservice/)
- [S Broker](https://www.sbroker.de/service/leistungen/plattformen/app)
- [Sparkasse](https://www.sparkasse.de/pk/produkte/sparen-und-anlegen/geld-anlegen/depot/s-neo.html)
- [Commerzbank](https://www.commerzbank.de/privatkunden/investieren/depot/)
- [maxblue](https://www.maxblue.de/wertpapierhandel/handeln/depot.html)
- [Interactive Brokers Germany availability](https://www.interactivebrokers.ie/de/accounts/open_account_country_list.php)

## New portfolio default

New portfolios use 27.99511%: the combined German capital-income tax, solidarity surcharge, and 9% church tax, rounded to six decimal places. The 8% church-tax and no-church-tax presets remain selectable. The generic 27% estimate has been removed from the preset list.

For church-tax fraction `c`, no creditable foreign tax, and the statutory 5.5% solidarity surcharge, the combined fraction is:

```
capital-income tax = 1 / (4 + c)
combined fraction = (1 + c + 0.055) / (4 + c)
c = 0.09 → combined rate = 27.995110024...%
```

The denominator incorporates the deduction of 25% of church tax from the capital-income tax itself. Sources: [§32d EStG](https://www.gesetze-im-internet.de/estg/__32d.html), [§43a EStG](https://www.gesetze-im-internet.de/estg/__43a.html), [§4 SolzG 1995](https://www.gesetze-im-internet.de/solzg_1995/__4.html), and [ELSTER capital-income tax help](https://www.elster.de/eportal/helpGlobal?themaGlobal=help_kapesta_2026).

Existing saved rates remain unchanged. A previously stored 27% appears as Custom; selecting and saving a preset is an explicit user preference change. There are no startup database rewrites or changes to previously recorded tax amounts.
