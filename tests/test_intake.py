import intake


def test_ticker_like_input_does_not_fuzzy_match_company_prefix(monkeypatch):
    import api.services.ticker_data as ticker_data

    monkeypatch.setattr(ticker_data, "get_ticker_name", lambda _ticker: None)
    ticker, company = intake.resolve_ticker("BE")
    assert ticker == "BE"
    assert company == "BE"


def test_loaded_ticker_data_is_used_before_company_name_fallback(monkeypatch):
    import api.services.ticker_data as ticker_data

    monkeypatch.setattr(
        ticker_data,
        "get_ticker_name",
        lambda ticker: "Bloom Energy Corporation" if ticker == "BE" else None,
    )
    ticker, company = intake.resolve_ticker("BE")
    assert ticker == "BE"
    assert company == "Bloom Energy Corporation"


def test_company_name_prefix_still_resolves_for_non_ticker_input(monkeypatch):
    import api.services.ticker_data as ticker_data

    monkeypatch.setattr(ticker_data, "get_ticker_name", lambda _ticker: None)
    ticker, company = intake.resolve_ticker("Berkshire")
    assert ticker in {"BRK.A", "BRK.B"}
    assert company == "Berkshire Hathaway Inc."
