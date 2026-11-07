# Town Pass bridge contract

Production URL: https://2026-town-pass.vercel.app （部署：`cd microservice/welfare && npx vercel deploy --prod`；Town Pass 建置時以 `--dart-define=WELFARE_URL=https://2026-town-pass.vercel.app` 指定）

The microservice page talks to Town Pass through the WebView message listener registered in `lib/util/web_message_handler/tp_web_message_listener.dart` (JS object `flutterObject`).

## Sending

```js
flutterObject.postMessage(JSON.stringify({ name: '<handler name>', data: <payload> }))
```

The App parses the message with `jsonDecode`, so it must be a JSON string. A message whose `name` matches no handler gets no reply.

## Receiving

Town Pass replies on the same object; each reply carries the handler `name` and `data` (see `tp_web_message_reply.dart`).

```js
flutterObject.addEventListener('message', (event) => {
  const { name, data } = JSON.parse(event.data)
})
```

Every listener receives every reply. Match replies by `name`; two requests with the same `name` in flight cannot be told apart.

Outside Town Pass (`typeof flutterObject === 'undefined'`), the page falls back to browser behaviour listed below so it stays usable in a normal browser.

## Handlers used by the microservice

| name | data sent | reply data | Use in the microservice | Browser fallback |
|---|---|---|---|---|
| `userinfo` | none | account object, or `[]` | Prefill birth year in the questionnaire | Ask the user |
| `phone_call` | phone number string | `true`/`false` | 「請人幫我」 → call 1999 or a helper | `tel:` link |
| `location` | none | position object, or `[]` | Nearby service points | `navigator.geolocation` |
| `open_link` | URL string | none on success, `false` on invalid data | Open an online application page | `window.open` |
| `launch_map` | map URL string | `true`/`false` | Directions to a counter | Open the map URL |

### `userinfo`

Send:

```js
flutterObject.postMessage(JSON.stringify({ name: 'userinfo', data: null }))
```

Reply (`Account.toJson()` from `lib/bean/account.dart`; values from `assets/mock_data/account.json`):

```json
{
  "name": "userinfo",
  "data": {
    "id": "7f3562f4-bb3f-4ec7-89b9-da3b4b5ff250",
    "account": "wz7786",
    "username": "Wesley",
    "realName": "金大森",
    "idNo": "A123456789",
    "email": "ist83903@bcaoo.com",
    "phoneNo": "0932166777",
    "birthday": "1988/12/12",
    "memberType": "personal",
    "verifyLevel": "3",
    "addresses": [
      {
        "zip3": 104,
        "city": "臺北市",
        "town": "中山區",
        "village": "正得里",
        "street": "吉林路",
        "usageType": "0",
        "seq": 1,
        "priority": true
      }
    ],
    "residentAddress": "臺北市中山區吉林路 69 號 4 樓",
    "citizen": true,
    "nativePeople": false,
    "cityInternetUid": ""
  }
}
```

| Field | Type | Meaning | Use in the microservice |
|---|---|---|---|
| `birthday` | string | Birth date, `yyyy/MM/dd` in the 西元 calendar (the App's edit page enforces this format) | Birth year → age |
| `residentAddress` | string | Registered address as free text | Residency only when the address is outside Taipei (`residentMonths = 0`) |
| `addresses[]` | array | Structured addresses: `zip3`, `city`, `town`, `village`, `street`, `usageType`, `seq`, `priority` | Not used |
| `nativePeople` | boolean | Indigenous status | Prefill the `indigenous` identity when `true` |
| `citizen` | boolean | Meaning not documented in the App | Not used |
| `realName`, `idNo`, `email`, `phoneNo` | string | Personal data | Not read or stored |
| `id`, `account`, `username`, `memberType`, `verifyLevel`, `cityInternetUid` | string | Account metadata | Not used |

Every field is always present. A string field the user has not set is `""`.

Errors and limits:

- No account: `data` is `[]` (an empty array, not `null`). Treat any non-object as "no account".
- The App loads one mock account at start-up (`AccountService.init`), so every device returns the same person unless the user edits the basic-info page. Use it for prefill, never as verified data.
- The account has no 設籍 date or duration. 設籍月數 comes from the questionnaire; a Taipei `residentAddress` does not answer it.
- No field covers low-income status, disability, household members or children. These come from the questionnaire.

### `location`

Send:

```js
flutterObject.postMessage(JSON.stringify({ name: 'location', data: null }))
```

Reply (`Position.toJson()` from `geolocator_platform_interface` 4.4.0; values illustrative):

```json
{
  "name": "location",
  "data": {
    "latitude": 25.0375,
    "longitude": 121.5637,
    "accuracy": 12.0,
    "timestamp": 1762480800000,
    "altitude": 10.0,
    "altitude_accuracy": 3.0,
    "floor": null,
    "heading": 0.0,
    "heading_accuracy": 0.0,
    "speed": 0.0,
    "speed_accuracy": 0.0,
    "is_mocked": false,
    "vertical_speed": 0.0,
    "vertical_speed_accuracy": 0.0,
    "has_accuracy": true,
    "has_altitude": true,
    "has_altitude_accuracy": true,
    "has_heading": false,
    "has_heading_accuracy": false,
    "has_speed": false,
    "has_speed_accuracy": false,
    "has_vertical_speed": false,
    "has_vertical_speed_accuracy": false
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `latitude`, `longitude` | number | WGS84 degrees |
| `accuracy` | number | Horizontal accuracy in metres |
| `timestamp` | number | Fix time, milliseconds since the Unix epoch |
| other keys | number, boolean or `null` | Not used by the microservice |

Errors and limits:

- Location service off, permission denied, or permission denied forever: `data` is `[]`. The reply does not say which; the App only logs the reason.
- The first request may show the system permission dialog, and `getCurrentPosition` waits for a fix, so the reply can take several seconds. A reply timeout shorter than about 15 seconds drops valid replies.
- On `[]` or timeout, ask for a district instead of retrying in a loop.

### `phone_call`

Send a string of digits; the App dials `tel://<data>` immediately, without a confirmation dialog.

```js
flutterObject.postMessage(JSON.stringify({ name: 'phone_call', data: '1999' }))
```

Reply:

```json
{ "name": "phone_call", "data": true }
```

| `data` | Meaning |
|---|---|
| `true` | The device can dial; the dialer opens right after the reply |
| `false` | The device cannot dial (for example a tablet without telephony), or `data` is invalid |

Errors: `data` that is not a non-empty string (`null`, a number, an object) or does not form a valid `tel://` URI replies `false` and dials nothing.

### `open_link`

Send an absolute URL string.

```js
flutterObject.postMessage(JSON.stringify({ name: 'open_link', data: 'https://example.com/apply' }))
```

Behaviour (`TPRoute.openUri`):

- Any scheme except `local`: opens the URL in a new Town Pass in-app WebView page, not the system browser.
- `local://<route>`: navigates to that Town Pass route.
- No reply on success.

Errors:

| `data` | Result |
|---|---|
| `null` or not a string | Reply `{ "name": "open_link", "data": false }` |
| `""` or an unparsable URL | Nothing opens, no reply |

### `launch_map`

Send a map URL string; the App opens it with the system handler when the device can.

```js
flutterObject.postMessage(JSON.stringify({ name: 'launch_map', data: 'https://www.google.com/maps/dir/?api=1&destination=25.0375,121.5637' }))
```

| `data` in the reply | Meaning |
|---|---|
| `true` | The URL can be opened; it opens right after the reply |
| `false` | The device cannot open the URL, or `data` is not a string or not a parsable URI |

## New handlers

A new handler (for example sharing a summary) is added by the App role in `tp_web_message_handler.dart`, registered in `tp_web_message_listener.dart`, and documented in this table in the same PR.
