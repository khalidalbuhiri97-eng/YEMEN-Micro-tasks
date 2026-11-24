# YT Coin Ecosystem

The YT Coin UI is isolated from the host application's page and authentication context.

## Current app integration

`YtEcosystemApp` receives the signed-in user, admin capability, and optional login callback as props. It uses the default `ytCoinService` adapter backed by the app's Supabase client.

## Standalone integration

Create a Supabase client for the same Supabase project, create an adapter, and pass it to the component:

```tsx
import { YtEcosystemApp, createYtCoinService } from './yt-ecosystem';
import { supabase } from './supabaseClient';

const ytService = createYtCoinService(supabase);

<YtEcosystemApp
  user={{ id: authUser.id, referralCode: authUser.referral_code }}
  isAdmin={authUser.isAdmin}
  service={ytService}
/>
```

The external app must authenticate users against the same Supabase Auth project. The database remains the source of truth for balances, claims, pricing, PIN checks, transfers, and withdrawals.

## Monetary display

All raw values are stored as BIGINT at 100,000 parts per YT. UI values must be formatted with `ytFormat`; convert decimal input through the service/RPC contract, never display raw storage values.

## Ad safety

Ad code is rendered only in sandboxed iframes without `allow-same-origin`. Ad completion uses server timestamps and a one-time session token; do not replace it with browser-only timers.
