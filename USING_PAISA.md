# Using paisa on your phone

**paisa** is a personal expense tracker for Indian banking — UPI, cards, and cash. It reads your bank & UPI emails to log transactions automatically, lets you import statements, and answers questions about your spending. This guide is for using it day-to-day on a phone.

Live app: **https://paisa-tawny.vercel.app**

---

## 1. Install it like an app (recommended)

paisa is a PWA, so you can add it to your home screen and it opens full-screen like a native app — no app store needed.

**Android (Chrome):**
1. Open **https://paisa-tawny.vercel.app** in Chrome
2. Tap the **⋮** menu → **Add to Home screen** (or **Install app**)
3. Tap **Install** — the ₹ icon appears on your home screen

**iPhone (Safari):**
1. Open **https://paisa-tawny.vercel.app** in Safari
2. Tap the **Share** button (□↑) → **Add to Home Screen**
3. Tap **Add**

> If you'd installed an earlier version, remove it and re-add it to pick up the new icon.

---

## 2. Sign in

Tap **Sign in with Google**. paisa only reads your **name and email** to identify your account. Connecting Gmail for transaction import is a **separate, optional** step you control (next section). Every account's data is private — no one else can see your transactions.

---

## 3. Auto-log transactions from Gmail (optional)

This is the magic feature — paisa reads bank/UPI/card *alert* emails and turns them into transactions.

1. Go to **Settings → Email connection**
2. Tap **Connect Gmail** → choose your account → **Allow**
3. Tap **Fetch recent** (or **Run now**) to pull your latest emails

From then on it syncs automatically in the background. It only looks at known bank / UPI / card senders — it ignores promotions and newsletters. An AI reads each alert to pull out the amount, merchant, and category, and skips duplicates.

**Review queue:** Settings → Email → **View inbox** shows what was pulled in and lets you fix anything.

---

## 4. Import a statement (PDF / Excel / CSV)

Got a bank or credit-card statement? Import it — format and bank don't matter.

1. **Settings → Email connection → Import a statement**
2. Tap **Choose File**, pick a **PDF, .xls/.xlsx, or CSV** (max 10 MB)
3. (Optional) enter a cardholder name for joint/family statements
4. Tap **Import**

Both spends and credits are extracted and categorized, and anything you already have (from email or an earlier import) is skipped automatically. Big statements import faster if you split them by month.

---

## 5. Add a transaction by hand

For cash or anything not in email: tap **+ Add** (top bar on desktop, or the bottom nav on mobile) → fill in amount, merchant, category, payment mode → **Save**.

---

## 6. Make it yours — categories & payment methods

- **Add spending categories:** Settings → **Categories**. Create top-level ones (e.g. *Pets*) or sub-categories (e.g. *Food › Coffee*), with an emoji icon. Archive ones you don't use.
- **Add a payment method / new bank account:** Settings → **Payment modes**. Add your own — e.g. *HDFC Bank*, *SBI Savings*, *Wallet*, *Gift card*. They show up in the "Paid via" dropdown.
- **Auto-categorization rules:** open any transaction → **Edit** → save a rule so future payments to that merchant get the right category automatically.

---

## 7. Budgets

Settings → **Monthly budgets**: set a soft monthly cap per category. The home page shows progress bars and warns you at 80%, plus how you're pacing through the month.

---

## 8. Ask paisa (the chat assistant)

Tap the **chat button** (bottom-right) and ask in plain English:

- *"What's my biggest UPI transaction this week?"*
- *"How much did I spend on food last month?"*
- *"Show my Swiggy spending this year."*

It reads your data and answers. (Give it a few seconds — it's doing real lookups.)

---

## 9. Find & filter

- **Search** (top of home): type a merchant, note, or category — e.g. `swiggy`, `goa`, `food`.
- **Date range:** Today / This week / This month / This year, or pick custom dates.
- **Tap a chart slice** ("By category" / "By payment mode") to filter the list to that slice. Tap again to clear.

---

## Privacy & safety

- Your transactions are private to your account.
- Gmail access is **read-only** and optional — revoke anytime at [myaccount.google.com/permissions](https://myaccount.google.com/permissions), or **Disconnect** inside Settings → Email.
- OAuth tokens are encrypted at rest.

---

*Tip: bookmark **https://paisa-tawny.vercel.app** — that's your app. Links that look like `paisa-<random>.vercel.app` are temporary preview builds.*
