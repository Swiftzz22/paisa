# App Review reply — paisa. 1.0

Two separate things came back. Do them in this order.

---

## Part A — the automated rejection (blocking, metadata only)

> The submission offers auto-renewable subscriptions … but does not include a
> functional link to the Terms of Use (EULA) in the app metadata.

Nothing in the app needs changing. The purchase sheet already shows the title,
length, price, renewal terms and links to both Terms and Privacy. Apple is
complaining about the **App Store product page**, not the binary.

paisa. has its own custom Terms, live at
`https://paisa-tawny.vercel.app/terms`, so do both of these:

1. **App Store Connect → your app → App Information → License Agreement →
   Edit → Custom License Agreement.** Paste the full text of the Terms page in.
   Apple needs the text itself here, not a link.

2. **App Store Connect → your app → the version → Description.** Add this as the
   last line:

   ```
   Terms of Use: https://paisa-tawny.vercel.app/terms
   Privacy Policy: https://paisa-tawny.vercel.app/privacy
   ```

   The automated check looks for a working Terms link in the description text.
   Both URLs return 200 — I checked.

3. Confirm **Privacy Policy URL** is filled in under App Privacy.

---

## Part B — the information request

Paste everything below into your reply in App Store Connect, and again into
**App Review Information → Notes** so you never have to write it twice.

---

### 1. Screen recording

Recorded separately — see the shot list at the bottom of this file.

### 2. What the app is for, and who it is for

paisa. is a personal expense tracker built for India.

Indian banks, cards and UPI apps send a notification email for nearly every
transaction. Almost nobody reads them, so the money is spent and forgotten, and
the person has no picture of where it went. Bank statements are the usual
alternative, but they are awkward to obtain, formatted differently by every
bank, and they leave out UPI spending that happened through other apps.

paisa. turns those alerts and statements into a single categorised record of
what someone spent: totals by day, week, month and year, a breakdown by
category, and a plain-language question box ("how much did I spend on food last
month?").

The audience is individuals in India tracking their own household spending. It
is single-user throughout. There is no social feature, no shared content, no
messaging, and nothing any user creates is visible to any other user — so the
content-reporting and blocking mechanisms mentioned in the guidelines do not
apply.

### 3. Getting in and reaching the main features

**Signing in.** The app has no password login. Sign in with Apple and Sign in
with Google are the only two options, so the reviewer can use their own Apple ID
directly — no demo credentials are needed or possible. Sign in with Apple is the
first button on the launch screen.

**Getting data in.** A new account is empty, because the app holds nothing until
the person supplies it. There are two routes, and the reviewer only needs the
first:

- **Upload a statement** — Settings → Add transactions → Upload a statement.
  Accepts CSV, Excel and PDF. A sample statement is here:

  `https://paisa-tawny.vercel.app/sample-statement.csv`

  Download it to the device (Safari → Downloads), then pick it in the file
  picker. It contains 30 fictional transactions and imports in a few seconds.
  This is included in the free tier, so no purchase is required to see the app
  fully populated.

- **Connect a mailbox** — Settings → Connect Gmail. This reads only bank and UPI
  notification emails, using Google's read-only scope. This route is part of the
  paid tier, so please use the statement upload above.

**Once there is data:**

| Feature | Where |
|---|---|
| Spending by Day / Week / Month / Year | Home, the four tabs at the top |
| Category breakdown and trend chart | Home, below the total |
| Full list, with edit and delete | Transactions tab → tap any row |
| Natural-language questions | Ask tab |
| Subscription | Settings → paisa. plus |
| **Account deletion** | Settings → Delete account → type your email to confirm |

Account deletion removes the account and everything in it permanently, and
revokes the Google and Apple grants at the same time.

### 4. External services used

| Service | What it does |
|---|---|
| Apple — Sign in with Apple, StoreKit | Sign-in; in-app purchase |
| RevenueCat | Validates Apple's purchase receipts and reports subscription status |
| Google — Sign in with Google | Optional alternative sign-in |
| Google — Gmail API (read-only scope) | Reads bank and UPI alert emails, only for users who explicitly connect a mailbox |
| Google — Gemini API | Reads uploaded statement files (CSV, Excel, PDF) and extracts the transactions |
| NVIDIA NIM (hosted inference) | Categorises transactions and answers questions in Ask |
| Vercel | Hosts the backend |
| Turso | Database |

There is no advertising network, no analytics or tracking SDK, and no data
broker. Nothing is sold or shared with third parties. The AI services receive
transaction text in order to categorise it and return a result; they are not
used to train models on user data.

### 5. Regional differences

The app behaves identically in every region. Nothing is gated, hidden or altered
by storefront or location.

It is built around Indian banks, UPI and the rupee, so it is most useful to
someone with an Indian bank account, but that is the subject matter rather than
a regional restriction. Subscription prices follow standard App Store regional
pricing.

### 6. Regulated activity and third-party material

paisa. is not a bank, a payment service or a financial institution, and it
provides no financial services. It cannot move money, make a payment, or reach
any bank account. It has no write access to anything.

What it does is read two things the user hands it: transaction notification
emails already sitting in their own mailbox, and statement files they upload
themselves — both only with explicit consent, and either can be revoked at any
time. From those it produces a summary of past spending.

It gives no investment, tax or financial advice, and makes no recommendations.
No licence is required for this and no third-party protected material is
included. All bank names that appear are the user's own transaction data.

### 7. In-app purchase

**paisa. plus** — one auto-renewable subscription, offered monthly or yearly.

Free, with no purchase and no time limit:

- The full dashboard, every chart, and all Day/Week/Month/Year views
- The complete transaction list, plus adding, editing and deleting
- Categories and budgets
- One statement import per calendar month
- Three questions in Ask per calendar month
- Account deletion

paisa. plus adds:

- Automatic sync from bank notification emails
- Unlimited statement imports
- Unlimited questions in Ask

Those three are the parts with a per-use server cost, which is the reason the
line falls there.

**How to reach the purchase screen:** Settings → paisa. plus. It also appears on
its own if you use your free import or your third question and then try again —
the refusal and the offer arrive together.

The purchase sheet shows each option's title, duration and price, states that it
renews automatically and how to cancel, and links to the Terms of Use and
Privacy Policy. It also has a Restore purchases button.

---

## Shot list for the screen recording (item 1)

Record on a physical iPhone, latest iOS, in one take if you can. Aim for three
to four minutes.

1. Launch from the home screen — show the app opening cold.
2. **Sign in with Apple.** Show the sheet and completing it.
3. Land on the empty home screen.
4. Settings → Add transactions → **Upload a statement** → pick
   `sample-statement.csv` → show the "Imported" confirmation.
5. Back to Home. Show the total, then tap through **Day, Week, Month, Year**.
   Let the category breakdown and the chart render.
6. **Transactions** tab → tap a row → show edit → change something → Save.
   Then open another and show Delete.
7. **Ask** tab → type a real question, e.g. "how much did I spend on groceries
   this month?" → show the answer.
8. Settings → **paisa. plus** → let the sheet load so the recording clearly
   shows: both options with title, length and price; the auto-renewal sentence;
   the Terms of Use and Privacy Policy links; Restore purchases. Hold still for
   a few seconds here — this is the part Apple's reviewer is checking.
9. Tap **Terms of Use** and let the page open. Go back. Do the same for
   **Privacy Policy**.
10. Settings → **Delete account** → show the confirmation page and the "type
    your email" step. You can stop before confirming, or use a throwaway
    account and complete it — completing it is stronger evidence.

---

## Before you submit — please check these three

**1. Statement import must actually work in production.** This is the route the
reviewer will use, so if it fails the submission fails. The Gemini key in the
local `.env` is dead — a plain models-list call returns 401 UNAUTHENTICATED, and
its prefix is `AQ.A` where Google AI Studio keys begin `AIza`. Production has
its own key that I cannot read, and the last successful import in production was
2026-08-29, a month ago. **Test it**: sign in at paisa-tawny.vercel.app, upload
`public/sample-statement.csv`, confirm transactions appear. If it fails, mint a
new key at aistudio.google.com/apikey and update `GOOGLE_GEMINI_API_KEY` in both
Vercel and `.env`. There is also a stray duplicate `Gemini_API_Key` variable in
Vercel worth deleting.

**2. The Google OAuth consent screen must be published.** If it is still in
"Testing" in Google Cloud, only accounts on your test list can sign in with
Google — everyone else is refused. The reviewer will use Apple, so this will not
block review, but it will block real users.

**3. Screenshots must show the app in use.** Guideline 2.3.3 — not the launch
screen or the sign-in screen. Take them after importing the sample statement so
there is real-looking data on screen.
