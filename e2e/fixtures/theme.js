// Dựng trang fixture giống theme: ?page=search|collection&currency=USD|EUR&native=1
(function () {
  const p = new URLSearchParams(location.search);
  const currency = p.get("currency") || "USD";
  window.SearchAppContext = {
    shop: "fixture.myshopify.com",
    publicKey: "pk_fixture",
    apiBase: "/apps/search",
    proxy: true,
    country: currency === "EUR" ? "DE" : "US",
    language: currency === "EUR" ? "de" : "en",
    currency,
    shopCurrency: "USD",
    moneyFormat: currency === "EUR" ? "{{amount_with_comma_separator}} €" : "${{amount}}",
    locale: "en",
    pageType: document.body.dataset.page,
    searchUrl: "/search.html",
    storefront: { endpoint: "/api/2026-10/graphql.json" },
  };
})();
