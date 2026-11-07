# Town Pass bridge contract

The microservice page talks to Town Pass through the WebView message listener registered in `lib/util/web_message_handler/tp_web_message_listener.dart` (JS object `flutterObject`).

## Sending

```js
flutterObject.postMessage(JSON.stringify({ name: '<handler name>', data: <payload> }))
```

## Receiving

Town Pass replies on the same object; each reply carries the handler `name` and `data` (see `tp_web_message_reply.dart`).

```js
flutterObject.addEventListener('message', (event) => {
  const { name, data } = JSON.parse(event.data)
})
```

Outside Town Pass (`typeof flutterObject === 'undefined'`), the page falls back to browser behaviour listed below so it stays usable in a normal browser.

## Handlers used by the microservice

| name | data sent | reply data | Use in the microservice | Browser fallback |
|---|---|---|---|---|
| `userinfo` | none | account object | Prefill birth year and residency in the questionnaire | Ask the user |
| `phone_call` | phone number string | — | 「請人幫我」 → call 1999 or a helper | `tel:` link |
| `location` | none | position | Nearby service points | `navigator.geolocation` |
| `open_link` | URL string | — | Open an online application page | `window.open` |
| `launch_map` | map URL string | `true`/`false` | Directions to a counter | Open the map URL |

Field shapes of `userinfo` and `location` replies are defined by the Dart handlers; the App role documents the exact JSON here before the Web role depends on them.

## New handlers

A new handler (for example sharing a summary) is added by the App role in `tp_web_message_handler.dart`, registered in `tp_web_message_listener.dart`, and documented in this table in the same PR.
