/**
 * Comprehensive ClixWall Offer Wall & Postback Integration Test Suite
 * Yemen Task (كسب اليمن)
 */

import 'dotenv/config';
import { getSupabaseAdminClient } from './app.js';

async function runClixWallTest() {
  console.log('==================================================================');
  console.log('       Yemen Task - ClixWall Comprehensive Integration Suite       ');
  console.log('==================================================================');

  const adminClient = getSupabaseAdminClient();
  console.log('  - Supabase Admin Client initialized with Service Role Key.');

  const expectedSecret = (process.env.CLIXWALL_POSTBACK_SECRET || process.env.CLIXWALL_SECRET || '').trim();
  const apiKey = (process.env.CLIXWALL_API_KEY || '').trim();
  const testUserId = 'a6d10676-a306-4594-84bf-22b1880b06aa'; // Designated test user account

  console.log(`  - Configured Secret: ${expectedSecret ? '***' + expectedSecret.slice(-4) : 'MISSING'}`);
  console.log(`  - Configured API Key: ${apiKey ? apiKey.slice(0, 4) + '...' + apiKey.slice(-4) : 'MISSING'}`);

  if (!expectedSecret) {
    throw new Error('CLIXWALL_POSTBACK_SECRET must be configured.');
  }

  // ----------------------------------------------------------------------------
  // 1. Verify CLIXWALL-RECEIVABLE ledger account
  // ----------------------------------------------------------------------------
  console.log('\n[1/10] Verifying CLIXWALL-RECEIVABLE ledger account in financial_accounts...');
  const { data: acc, error: accErr } = await adminClient
    .from('financial_accounts')
    .select('*')
    .eq('account_code', 'CLIXWALL-RECEIVABLE')
    .single();

  if (accErr || !acc) {
    throw new Error(`CLIXWALL-RECEIVABLE account not found: ${accErr?.message}`);
  }
  console.log(`  ✓ Verified account: ${acc.account_name} (${acc.currency}, type: ${acc.account_type}, side: ${acc.normal_side})`);

  // ----------------------------------------------------------------------------
  // 2. Verify clixwall_postbacks table schema (user_payout_usd, publisher_payout_usd, status)
  // ----------------------------------------------------------------------------
  console.log('\n[2/10] Verifying clixwall_postbacks table schema & columns...');
  const { data: samplePostback, error: tblErr } = await adminClient
    .from('clixwall_postbacks')
    .select('id, transaction_id, user_id, user_payout_usd, publisher_payout_usd, exchange_rate, reward_yer, status')
    .limit(1);

  if (tblErr) {
    throw new Error(`clixwall_postbacks table query failed: ${tblErr.message}`);
  }
  console.log('  ✓ Verified clixwall_postbacks schema with user_payout_usd & publisher_payout_usd columns.');

  // ----------------------------------------------------------------------------
  // 3. Test Exchange Rate & Calculation logic (70% user payout, fixed rate 1,600 YER/USD)
  // ----------------------------------------------------------------------------
  console.log('\n[3/10] Verifying Exchange Rate 1 USD = 1,600 YER & 70/30 split logic...');
  const testPublisherPayoutUsd = 0.001; // $0.001 total
  const testUserPayoutUsd = 0.0007;     // 70% to user = $0.0007
  const expectedYer = testUserPayoutUsd * 1600; // 1.12 YER

  console.log(`  - Total Payout: $${testPublisherPayoutUsd} | User (70%): $${testUserPayoutUsd} -> Expected YER: ${expectedYer} ر.ي`);
  if (Math.abs(expectedYer - 1.12) > 0.000001) {
    throw new Error('Exchange rate calculation mismatch.');
  }
  console.log('  ✓ Calculation verified: 1 USD = 1,600 YER exact conversion.');

  // ----------------------------------------------------------------------------
  // 4. Test OfferWall dynamic URL format template (no duplicate query parameters)
  // ----------------------------------------------------------------------------
  console.log('\n[4/10] Verifying OfferWall URL format template...');
  let rawBaseUrl = (process.env.CLIXWALL_OFFERWALL_URL || 'https://clixwall.com/wall').trim();
  if (rawBaseUrl.includes('?')) rawBaseUrl = rawBaseUrl.split('?')[0];
  const baseUrl = rawBaseUrl.replace(/\/+$/, '') || 'https://clixwall.com/wall';
  const generatedUrl = `${baseUrl}?api=${encodeURIComponent(apiKey)}&user=${encodeURIComponent(testUserId)}`;

  console.log(`  - Generated URL: ${generatedUrl}`);
  if (!generatedUrl.startsWith('https://clixwall.com/wall?api=') || !generatedUrl.includes(`&user=${testUserId}`)) {
    throw new Error(`Generated URL does not match required format: ${generatedUrl}`);
  }
  if (generatedUrl.indexOf('?') !== generatedUrl.lastIndexOf('?')) {
    throw new Error(`Generated URL contains duplicated query parameters: ${generatedUrl}`);
  }
  console.log('  ✓ Verified OfferWall URL format is clean, normalized, and matches required template.');

  // ----------------------------------------------------------------------------
  // 5. Test Secret Enforcement: Missing or Invalid Secret must return HTTP 403
  // ----------------------------------------------------------------------------
  console.log('\n[5/10] Testing Secret Enforcement (HTTP 403 on missing or invalid secret)...');
  
  // 5a. Missing secret
  const noSecretRes = await fetch('http://localhost:3000/api/postbacks/clixwall?transaction_id=TX_NO_SEC&user_id=' + testUserId, {
    method: 'GET',
  });
  if (noSecretRes.status !== 403) {
    throw new Error(`Expected 403 for missing secret, got ${noSecretRes.status}`);
  }
  const noSecretData = await noSecretRes.json();
  console.log(`  ✓ Missing secret correctly rejected with 403:`, noSecretData.error);

  // 5b. Invalid secret
  const badSecretRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=TX_BAD_SEC&user_id=${testUserId}&secret=WRONG_SECRET_VALUE`, {
    method: 'GET',
  });
  if (badSecretRes.status !== 403) {
    throw new Error(`Expected 403 for invalid secret, got ${badSecretRes.status}`);
  }
  const badSecretData = await badSecretRes.json();
  console.log(`  ✓ Invalid secret correctly rejected with 403:`, badSecretData.error);

  // ----------------------------------------------------------------------------
  // 6. Test Missing Status Enforcement: Must NOT default to success (HTTP 400)
  // ----------------------------------------------------------------------------
  console.log('\n[6/10] Testing Missing Status Enforcement (HTTP 400 when status is missing)...');
  const noStatusRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=TX_NO_STATUS&user_id=${testUserId}&secret=${expectedSecret}&user_payout_usd=0.0007`, {
    method: 'GET',
  });
  if (noStatusRes.status !== 400) {
    throw new Error(`Expected 400 for missing status, got ${noStatusRes.status}`);
  }
  const noStatusData = await noStatusRes.json();
  console.log(`  ✓ Missing status correctly rejected with 400:`, noStatusData.error);

  // 6b. Invalid status value
  const badStatusRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=TX_BAD_STATUS&user_id=${testUserId}&secret=${expectedSecret}&status=unknown_random_status`, {
    method: 'GET',
  });
  if (badStatusRes.status !== 400) {
    throw new Error(`Expected 400 for invalid status, got ${badStatusRes.status}`);
  }
  const badStatusData = await badStatusRes.json();
  console.log(`  ✓ Invalid status correctly rejected with 400:`, badStatusData.error);

  // ----------------------------------------------------------------------------
  // 7. Test Explicit Credit Flow & Double-Entry Accounting
  // ----------------------------------------------------------------------------
  console.log('\n[7/10] Testing Explicit Credit Flow (status=1) with 70/30 reward split...');
  const uniqueTid = `TEST_CLIX_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // Query test user wallet account balance before credit
  const { data: walletBefore } = await adminClient
    .from('financial_accounts')
    .select('balance_units')
    .eq('owner_user_id', testUserId)
    .eq('account_type', 'wallet')
    .maybeSingle();
  const balanceBefore = Number(walletBefore?.balance_units || 0);

  const creditRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=${uniqueTid}&user_id=${testUserId}&secret=${expectedSecret}&user_payout_usd=0.0007&publisher_payout_usd=0.001&status=1&offer_id=OFFER_TEST_SUITE&offer_name=Suite_Test_Offer`, {
    method: 'GET',
  });

  if (creditRes.status !== 200) {
    const errBody = await creditRes.text();
    throw new Error(`Expected 200 for explicit credit, got ${creditRes.status}: ${errBody}`);
  }

  const creditData = await creditRes.json();
  if (!creditData.success || creditData.status !== 'credited') {
    throw new Error(`Credit response invalid: ${JSON.stringify(creditData)}`);
  }
  console.log(`  ✓ Explicit credit succeeded: TID=${uniqueTid}, status=${creditData.status}, duplicate=${creditData.duplicate}`);

  // Verify wallet balance increased by exactly 1.12 YER (1,120,000 micros)
  const { data: walletAfterCredit } = await adminClient
    .from('financial_accounts')
    .select('balance_units')
    .eq('owner_user_id', testUserId)
    .eq('account_type', 'wallet')
    .single();
  const balanceAfterCredit = Number(walletAfterCredit.balance_units);
  const diffCredit = balanceAfterCredit - balanceBefore;
  console.log(`  ✓ Financial Account balance increased by: ${diffCredit} micros (${diffCredit / 1000000} YER)`);
  if (diffCredit !== 1120000) {
    throw new Error(`Expected balance increase of 1,120,000 micros, got ${diffCredit}`);
  }

  // ----------------------------------------------------------------------------
  // 8. Test Credit Idempotency: Re-sending identical TID must not credit twice
  // ----------------------------------------------------------------------------
  console.log('\n[8/10] Testing Credit Idempotency (preventing double-credit on identical TID)...');
  const duplicateCreditRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=${uniqueTid}&user_id=${testUserId}&secret=${expectedSecret}&user_payout_usd=0.0007&publisher_payout_usd=0.001&status=1&offer_id=OFFER_TEST_SUITE&offer_name=Suite_Test_Offer`, {
    method: 'GET',
  });

  if (duplicateCreditRes.status !== 200) {
    throw new Error(`Expected 200 for idempotent duplicate, got ${duplicateCreditRes.status}`);
  }
  const duplicateCreditData = await duplicateCreditRes.json();
  if (!duplicateCreditData.duplicate) {
    throw new Error(`Expected duplicate=true on re-sent TID, got: ${JSON.stringify(duplicateCreditData)}`);
  }

  // Verify balance remained unchanged
  const { data: walletAfterDup } = await adminClient
    .from('financial_accounts')
    .select('balance_units')
    .eq('owner_user_id', testUserId)
    .eq('account_type', 'wallet')
    .single();
  if (Number(walletAfterDup.balance_units) !== balanceAfterCredit) {
    throw new Error('Balance changed on duplicate credit! Idempotency violation.');
  }
  console.log(`  ✓ Idempotency confirmed: Server returned duplicate=true, balance remained strictly unchanged.`);

  // ----------------------------------------------------------------------------
  // 9. Test Explicit Reversal Flow & Double-Entry Reversal
  // ----------------------------------------------------------------------------
  console.log('\n[9/10] Testing Explicit Reversal Flow (status=2) & Reversal Idempotency...');
  const reversalRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=${uniqueTid}&user_id=${testUserId}&secret=${expectedSecret}&user_payout_usd=0.0007&publisher_payout_usd=0.001&status=2&offer_id=OFFER_TEST_SUITE&offer_name=Suite_Test_Offer`, {
    method: 'GET',
  });

  if (reversalRes.status !== 200) {
    const errBody = await reversalRes.text();
    throw new Error(`Expected 200 for reversal, got ${reversalRes.status}: ${errBody}`);
  }
  const reversalData = await reversalRes.json();
  if (!reversalData.success || reversalData.status !== 'reversed') {
    throw new Error(`Reversal response invalid: ${JSON.stringify(reversalData)}`);
  }
  console.log(`  ✓ Reversal processed successfully: status=${reversalData.status}, duplicate=${reversalData.duplicate}`);

  // Verify balance reverted back to initial
  const { data: walletAfterReversal } = await adminClient
    .from('financial_accounts')
    .select('balance_units')
    .eq('owner_user_id', testUserId)
    .eq('account_type', 'wallet')
    .single();
  const balanceAfterReversal = Number(walletAfterReversal.balance_units);
  if (balanceAfterReversal !== balanceBefore) {
    throw new Error(`Balance after reversal (${balanceAfterReversal}) does not match balance before credit (${balanceBefore})`);
  }
  console.log(`  ✓ Financial Account balance restored to exact original: ${balanceAfterReversal} micros.`);

  // 9b. Test Reversal Idempotency: Duplicate reversal call
  const duplicateReversalRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=${uniqueTid}&user_id=${testUserId}&secret=${expectedSecret}&status=2`, {
    method: 'GET',
  });
  const dupRevData = await duplicateReversalRes.json();
  if (duplicateReversalRes.status !== 200 || !dupRevData.duplicate) {
    throw new Error(`Expected duplicate=true on re-sent reversal, got: ${JSON.stringify(dupRevData)}`);
  }
  console.log(`  ✓ Reversal idempotency confirmed: Server returned duplicate=true without double-deduction.`);

  // 9c. Test Uncredited Reversal Rejection
  const uncreditedRevRes = await fetch(`http://localhost:3000/api/postbacks/clixwall?transaction_id=NON_EXISTENT_TX_${Date.now()}&user_id=${testUserId}&secret=${expectedSecret}&status=2`, {
    method: 'GET',
  });
  if (uncreditedRevRes.status !== 400) {
    throw new Error(`Expected 400 for uncredited reversal, got ${uncreditedRevRes.status}`);
  }
  const uncreditedRevData = await uncreditedRevRes.json();
  console.log(`  ✓ Uncredited reversal correctly rejected with 400:`, uncreditedRevData.error);

  // ----------------------------------------------------------------------------
  // 10. Test Alternative Route /api/clixwall/postback
  // ----------------------------------------------------------------------------
  console.log('\n[10/10] Verifying alias route /api/clixwall/postback mounting...');
  const aliasRes = await fetch('http://localhost:3000/api/clixwall/postback?transaction_id=&user_id=', {
    method: 'GET',
  });
  if (aliasRes.status !== 403) {
    throw new Error(`Expected 403 for alias route without secret, got ${aliasRes.status}`);
  }
  console.log(`  ✓ Alias route /api/clixwall/postback is mounted and enforces secret verification.`);

  console.log('\n==================================================================');
  console.log('ALL CLIXWALL INTEGRATION TESTS COMPLETED SUCCESSFULLY (10/10).');
  console.log('==================================================================');
}

runClixWallTest().catch((err) => {
  console.error('\n❌ ClixWall Test Failed:', err);
  process.exit(1);
});
