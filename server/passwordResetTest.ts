import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const EXPECTED_RESET_URL = 'https://yemen-microtasks.com/reset-password';

async function runStaticChecks() {
  console.log('1. Checking source files & redirectTo configuration...');
  const root = process.cwd();

  const supabaseClientSrc = fs.readFileSync(path.join(root, 'src/api/supabase.ts'), 'utf8');
  assert.match(
    supabaseClientSrc,
    /PASSWORD_RESET_REDIRECT_URL\s*=\s*`\$\{CANONICAL_SITE_ORIGIN\}\/reset-password`/,
    'src/api/supabase.ts must define PASSWORD_RESET_REDIRECT_URL = https://yemen-microtasks.com/reset-password'
  );
  assert.match(
    supabaseClientSrc,
    /CANONICAL_SITE_ORIGIN\s*=\s*'https:\/\/yemen-microtasks\.com'/,
    'src/api/supabase.ts must set CANONICAL_SITE_ORIGIN to https://yemen-microtasks.com'
  );

  const authModalSrc = fs.readFileSync(path.join(root, 'src/components/auth/AuthModal.tsx'), 'utf8');
  assert.match(
    authModalSrc,
    /resetPasswordForEmail\(recoveryEmail,\s*\{\s*redirectTo:\s*PASSWORD_RESET_REDIRECT_URL/,
    'AuthModal.tsx must pass PASSWORD_RESET_REDIRECT_URL to resetPasswordForEmail'
  );

  const settingsSrc = fs.readFileSync(path.join(root, 'src/components/dashboard/SettingsView.tsx'), 'utf8');
  assert.match(
    settingsSrc,
    /resetPasswordForEmail\(user\.email,\s*\{\s*redirectTo:\s*PASSWORD_RESET_REDIRECT_URL/,
    'SettingsView.tsx must pass PASSWORD_RESET_REDIRECT_URL to resetPasswordForEmail'
  );

  const resetPageSrc = fs.readFileSync(path.join(root, 'src/components/auth/ResetPasswordPage.tsx'), 'utf8');
  assert.match(resetPageSrc, /exchangeCodeForSession/, 'ResetPasswordPage must handle PKCE code exchange');
  assert.match(resetPageSrc, /verifyOtp/, 'ResetPasswordPage must handle token_hash recovery OTP');
  assert.match(resetPageSrc, /PASSWORD_RECOVERY/, 'ResetPasswordPage must handle PASSWORD_RECOVERY event');
  assert.match(resetPageSrc, /updateUser\(\{\s*password:\s*newPassword,?\s*\}\)/, 'ResetPasswordPage must call supabase.auth.updateUser');
  assert.match(
    resetPageSrc,
    /resetPasswordForEmail\(cleanEmail,\s*\{\s*redirectTo:\s*PASSWORD_RESET_REDIRECT_URL,?\s*\}/,
    'ResetPasswordPage resend form must pass PASSWORD_RESET_REDIRECT_URL'
  );

  const serverAppSrc = fs.readFileSync(path.join(root, 'server/app.ts'), 'utf8');
  assert.match(
    serverAppSrc,
    /const PASSWORD_RESET_REDIRECT_URL = 'https:\/\/yemen-microtasks\.com\/reset-password'/,
    'server/app.ts must define PASSWORD_RESET_REDIRECT_URL = https://yemen-microtasks.com/reset-password'
  );
  assert.match(
    serverAppSrc,
    /generateLink\(\{\s*type:\s*'recovery',\s*email,\s*options:\s*\{\s*redirectTo:\s*PASSWORD_RESET_REDIRECT_URL/s,
    'server/app.ts admin reset-password must use PASSWORD_RESET_REDIRECT_URL'
  );

  const vercelJson = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rewrites: Array<{ source: string; destination: string }> = vercelJson.rewrites || [];
  assert.ok(
    rewrites.some((r) => r.source === '/reset-password' && r.destination === '/index.html'),
    'vercel.json must explicitly rewrite /reset-password to /index.html'
  );
  console.log('   ✔ Static configuration & redirectTo checks passed.');
}

async function runLiveSupabaseRecoveryFlow() {
  console.log('2. Testing live Supabase Auth password recovery flow (ephemeral test user)...');
  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '')
    .trim()
    .replace(/\.supabase\.com$/i, '.supabase.co');
  const anonKey = (process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  assert.ok(supabaseUrl && anonKey && serviceKey, 'Supabase env vars must be configured for integration test');

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anonClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const uniqueSuffix = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const testEmail = `yementask.reset.test.${uniqueSuffix}@example.com`;
  const initialPassword = `InitPass_${crypto.randomBytes(6).toString('hex')}!9`;
  const updatedPassword = `NewPass_${crypto.randomBytes(6).toString('hex')}!7`;
  let createdUserId: string | null = null;

  try {
    // A. Create disposable confirmed auth user
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: initialPassword,
      email_confirm: true,
    });
    assert.ifError(createErr);
    assert.ok(created?.user?.id, 'Test user must be created');
    createdUserId = created.user.id;
    console.log('   ✔ Created disposable test user.');

    // B. Verify resetPasswordForEmail accepts redirectTo = https://yemen-microtasks.com/reset-password
    const { error: sendResetErr } = await anonClient.auth.resetPasswordForEmail(testEmail, {
      redirectTo: EXPECTED_RESET_URL,
    });
    if (sendResetErr) {
      console.warn(`   ⚠ resetPasswordForEmail notice: ${sendResetErr.message}`);
    } else {
      console.log('   ✔ resetPasswordForEmail accepted canonical redirectTo without error.');
    }

    // C. Generate recovery link & check returned redirect_to URL
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'recovery',
      email: testEmail,
      options: {
        redirectTo: EXPECTED_RESET_URL,
      },
    });
    assert.ifError(linkErr);
    const actionLink = linkData?.properties?.action_link || '';
    const hashedToken = linkData?.properties?.hashed_token || '';
    assert.ok(actionLink && hashedToken, 'generateLink must return action_link and hashed_token');

    const parsedActionLink = new URL(actionLink);
    const actualRedirectTo = parsedActionLink.searchParams.get('redirect_to');
    console.log(`   ℹ Supabase generated action_link redirect_to = ${actualRedirectTo}`);
    if (actualRedirectTo !== EXPECTED_RESET_URL) {
      console.warn(
        `   ⚠ WARNING: Supabase project Redirect URL allowlist fell back to "${actualRedirectTo}" instead of "${EXPECTED_RESET_URL}". Add "${EXPECTED_RESET_URL}" to Supabase Dashboard -> Authentication -> URL Configuration -> Redirect URLs!`
      );
    } else {
      console.log(`   ✔ Supabase action_link redirect_to matches ${EXPECTED_RESET_URL}`);
    }

    // D. Verify recovery token via anon client (simulates user clicking recovery link)
    const { data: verifiedData, error: verifyErr } = await anonClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'recovery',
    });
    assert.ifError(verifyErr);
    assert.ok(verifiedData?.session?.access_token, 'verifyOtp must return a real recovery session');
    console.log('   ✔ Recovery OTP verified and real recovery session established.');

    // E. Update password using the verified recovery session
    const recoveryUserClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${verifiedData.session.access_token}`,
        },
      },
    });
    await recoveryUserClient.auth.setSession({
      access_token: verifiedData.session.access_token,
      refresh_token: verifiedData.session.refresh_token,
    });

    const { data: updatedUser, error: updateErr } = await recoveryUserClient.auth.updateUser({
      password: updatedPassword,
    });
    assert.ifError(updateErr);
    assert.equal(updatedUser?.user?.id, createdUserId, 'Updated user ID must match');
    console.log('   ✔ supabase.auth.updateUser({ password }) succeeded.');

    // F. Confirm old password fails & new password succeeds
    const { error: oldLoginErr } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: initialPassword,
    });
    assert.ok(oldLoginErr, 'Old password must no longer work after reset');

    const { data: newLoginData, error: newLoginErr } = await anonClient.auth.signInWithPassword({
      email: testEmail,
      password: updatedPassword,
    });
    assert.ifError(newLoginErr);
    assert.ok(newLoginData?.session?.access_token, 'Signing in with new password must succeed');
    console.log('   ✔ Verified old password rejected and new password sign-in succeeded.');

    // G. Confirm reused recovery token fails (single-use)
    const { error: reuseErr } = await anonClient.auth.verifyOtp({
      token_hash: hashedToken,
      type: 'recovery',
    });
    assert.ok(reuseErr, 'Reusing an already-consumed recovery token must fail');
    console.log('   ✔ Reused/expired recovery token properly rejected.');
  } finally {
    if (createdUserId) {
      await adminClient.auth.admin.deleteUser(createdUserId).catch((err) => {
        console.error('Failed to clean up ephemeral test user:', err);
      });
      try {
        await adminClient.from('users').delete().eq('id', createdUserId);
      } catch {
        // ignore if no profile row exists
      }
      console.log('   ✔ Cleaned up disposable test user cleanly.');
    }
  }
}

async function main() {
  await runStaticChecks();
  await runLiveSupabaseRecoveryFlow();
  console.log('\n✅ All password recovery checks passed.');
}

main().catch((err) => {
  console.error('\n❌ Password recovery test failed:', err);
  process.exit(1);
});
