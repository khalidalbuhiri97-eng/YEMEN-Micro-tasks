import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
import app, { supabaseServer } from './app.js';
import { supabaseDb } from './supabaseDb.js';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function reqJson(baseUrl: string, path: string, options: { method?: string; token?: string; body?: any } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function cleanupDisposableUser(adminClient: any, uid: string | null) {
  if (!uid) return;
  await adminClient.from('platform_settings').delete().like('key', `exec_sess_${uid}_%`).catch(() => {});
  await adminClient.from('platform_settings').delete().like('key', `survey_attempt_%_${uid}_%`).catch(() => {});
  await adminClient.from('user_roles').delete().eq('user_id', uid).catch(() => {});
  await adminClient.from('wallets').delete().eq('user_id', uid).catch(() => {});
  await adminClient.from('financial_accounts').delete().eq('owner_user_id', uid).eq('balance_units', 0).catch(() => {});
  await adminClient.from('profiles').delete().eq('id', uid).catch(() => {});
  await adminClient.auth.admin.deleteUser(uid).catch(() => {});
}

async function main() {
  if (!supabaseServer) {
    throw new Error('supabaseServer missing');
  }
  const adminClient = supabaseServer;
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const createdTaskIds: string[] = [];
  let createdSurveyId: string | null = null;
  let testUserId: string | null = null;
  let testAdminId: string | null = null;
  let adminToken = '';

  const getTreasurySnapshot = async () => {
    const t = await supabaseDb.getTreasurySummary();
    return {
      treasuryAvailable: Number(t.treasuryAvailable || 0),
      taskBudgetReserved: Number(t.taskBudgetReserved || 0),
      isReconciled: Boolean(t.isReconciled),
    };
  };

  const beforeTreasury = await getTreasurySnapshot();
  console.log(`[1/7] Baseline treasury snapshot:`, beforeTreasury);

  try {
    const randSuffix = crypto.randomBytes(4).toString('hex');

    // Create disposable admin via register + promote role on disposable ID only
    const adminPhone = `73${Math.floor(1000000 + Math.random() * 8999999)}`;
    const tmpAdminEmail = `e2e_admin_${randSuffix}@kasbyemen.local`;
    const tmpAdminPass = `AdminPass!_${randSuffix}`;
    const regAdmin = await reqJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'مدير اختبار مؤقت',
        phone: adminPhone,
        email: tmpAdminEmail,
        password: tmpAdminPass,
        city: 'صنعاء',
      },
    });
    assert.strictEqual(regAdmin.status, 200, `Disposable admin register failed: ${JSON.stringify(regAdmin.data)}`);
    testAdminId = regAdmin.data.user?.id;
    assert.ok(testAdminId, 'Disposable admin ID missing');

    await adminClient.from('profiles').update({ role: 'admin', account_status: 'active' }).eq('id', testAdminId);
    await adminClient.from('user_roles').upsert({ user_id: testAdminId, role: 'admin' }, { onConflict: 'user_id' });

    const adminLogin = await reqJson(baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { identifier: tmpAdminEmail, password: tmpAdminPass },
    });
    assert.strictEqual(adminLogin.status, 200, `Disposable admin login failed: ${JSON.stringify(adminLogin.data)}`);
    assert.strictEqual(adminLogin.data.user?.role, 'admin', 'Expected admin role on disposable test admin');
    adminToken = adminLogin.data.token;

    // Register disposable performer user
    const randPhone = `77${Math.floor(1000000 + Math.random() * 8999999)}`;
    const testEmail = `e2e_task_${randSuffix}@kasbyemen.local`;
    const testPass = `TestPass!_${randSuffix}`;
    const regRes = await reqJson(baseUrl, '/api/auth/register', {
      method: 'POST',
      body: {
        fullName: 'مستخدم اختبار المهام المؤقت',
        phone: randPhone,
        email: testEmail,
        password: testPass,
        city: 'صنعاء',
      },
    });
    assert.strictEqual(regRes.status, 200, `Register failed: ${JSON.stringify(regRes.data)}`);
    const userToken = regRes.data.token;
    testUserId = regRes.data.user?.id;
    assert.ok(userToken && testUserId, 'Test user token/id missing');
    console.log('[2/7] Authenticated disposable admin + disposable performer user');

    // 3. Test Sequential Survey E2E (all 7 question types + imageUrl + conditional branch + save/resume + required block)
    const qIds = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'];
    const surveyCreate = await reqJson(baseUrl, '/api/admin/surveys', {
      method: 'POST',
      token: adminToken,
      body: {
        title: `استبيان اختبار E2E ${randSuffix}`,
        description: 'استبيان اختبار شامل لجميع أنواع الأسئلة والتفريع',
        rewardYer: 0,
        estimatedMinutes: 3,
        maxParticipants: 10,
        maxAttemptsPerUser: 1,
        status: 'active',
        questions: [
          {
            id: qIds[0],
            questionText: 'هل تفضل المهام السريعة أم الاستبيانات؟',
            questionType: 'single_choice',
            isRequired: true,
            imageUrl: '/assets/tasks/task_social_follow.jpg',
            orderIndex: 0,
            options: [
              { id: 'q1_o1', optionText: 'الاستبيانات', orderIndex: 0, nextQuestionId: null },
              { id: 'q1_o2', optionText: 'المهام السريعة (قفز للسؤال 3)', orderIndex: 1, nextQuestionId: qIds[2] },
            ],
          },
          {
            id: qIds[1],
            questionText: 'ما أنواع الخدمات الإضافية التي تهتم بها؟',
            questionType: 'multiple_choice',
            isRequired: false,
            orderIndex: 1,
            options: [
              { id: 'q2_o1', optionText: 'مشاهدة الفيديو', orderIndex: 0 },
              { id: 'q2_o2', optionText: 'تجربة التطبيقات', orderIndex: 1 },
            ],
          },
          {
            id: qIds[2],
            questionText: 'هل واجهت أي صعوبة؟',
            questionType: 'yes_no',
            isRequired: true,
            orderIndex: 2,
            options: [
              { id: 'q3_yes', optionText: 'نعم', orderIndex: 0 },
              { id: 'q3_no', optionText: 'لا', orderIndex: 1 },
            ],
          },
          { id: qIds[3], questionText: 'اكتب كلمة مختصرة', questionType: 'short_text', isRequired: true, orderIndex: 3, options: [] },
          { id: qIds[4], questionText: 'اكتب رأيك التفصيلي', questionType: 'long_text', isRequired: true, orderIndex: 4, options: [] },
          { id: qIds[5], questionText: 'كم عدد المهام اليومية المفضلة؟', questionType: 'number', isRequired: true, orderIndex: 5, options: [] },
          { id: qIds[6], questionText: 'تقييمك العام من 1 إلى 5', questionType: 'rating_1_5', isRequired: true, orderIndex: 6, options: [] },
        ],
      },
    });
    assert.strictEqual(surveyCreate.status, 200, `Survey create failed: ${JSON.stringify(surveyCreate.data)}`);
    createdSurveyId = surveyCreate.data.survey?.id;
    assert.ok(createdSurveyId, 'Survey ID missing');

    const startSurvey = await reqJson(baseUrl, `/api/surveys/${createdSurveyId}/start`, { method: 'POST', token: userToken });
    assert.strictEqual(startSurvey.status, 200, `Start survey failed: ${JSON.stringify(startSurvey.data)}`);
    const attemptId = startSurvey.data.attempt.id;

    // Save partial progress with conditional jump selection on Q1 (skips Q2!)
    const partialAnswers = { [qIds[0]]: 'المهام السريعة (قفز للسؤال 3)' };
    const saveProg = await reqJson(baseUrl, `/api/surveys/attempts/${attemptId}/progress`, {
      method: 'PUT',
      token: userToken,
      body: { answers: partialAnswers, currentQuestionId: qIds[2] },
    });
    assert.strictEqual(saveProg.status, 200);

    // Reload survey & verify resume state + question imageUrl preserved
    const reloadSurvey = await reqJson(baseUrl, `/api/surveys/${createdSurveyId}`, { token: userToken });
    assert.strictEqual(reloadSurvey.status, 200);
    assert.strictEqual(reloadSurvey.data.survey.questions[0].imageUrl, '/assets/tasks/task_social_follow.jpg');
    assert.strictEqual(reloadSurvey.data.activeAttempt?.currentQuestionId, qIds[2]);

    // Submitting incomplete survey MUST fail with 400
    const badSubmitSurvey = await reqJson(baseUrl, `/api/surveys/attempts/${attemptId}/submit`, {
      method: 'POST',
      token: userToken,
      body: { answers: partialAnswers },
    });
    assert.strictEqual(badSubmitSurvey.status, 400, 'Expected incomplete required survey submission to return 400');

    // Completing reachable required questions (Notice Q2 was skipped by branch; Q3..Q7 answered)
    const fullAnswers = {
      [qIds[0]]: 'المهام السريعة (قفز للسؤال 3)',
      [qIds[2]]: 'لا',
      [qIds[3]]: 'ممتاز',
      [qIds[4]]: 'التجربة سلسة وسريعة جداً.',
      [qIds[5]]: '5',
      [qIds[6]]: 5,
    };
    const okSubmitSurvey = await reqJson(baseUrl, `/api/surveys/attempts/${attemptId}/submit`, {
      method: 'POST',
      token: userToken,
      body: { answers: fullAnswers },
    });
    assert.strictEqual(okSubmitSurvey.status, 200, `Survey final submit failed: ${JSON.stringify(okSubmitSurvey.data)}`);
    assert.strictEqual(okSubmitSurvey.data.ok, true);
    console.log('[3/7] Sequential survey E2E passed (all 7 types + imageUrl + branching + save/resume + required guard)');

    // 4. Security guard check: account_signup task requesting password MUST be rejected (400)
    const badSignupTask = await reqJson(baseUrl, '/api/admin/tasks', {
      method: 'POST',
      token: adminToken,
      body: {
        title: `اختبار أمني مرفوض ${randSuffix}`,
        description: 'أرسل كلمة المرور الخاصة بحسابك الجديد',
        category: 'local_services',
        taskKind: 'account_signup',
        rewardYer: 1,
        totalQuantity: 1,
        timeEstimateMinutes: 5,
        taskMeta: { taskKind: 'account_signup', difficulty: 'easy', fields: { partnerName: 'Partner' } },
      },
    });
    assert.strictEqual(badSignupTask.status, 400, 'Expected account_signup task requesting password to be rejected with 400');

    // 5. Create 1 task for each of the 8 canonical task types
    const createTask = async (payload: any) => {
      const r = await reqJson(baseUrl, '/api/admin/tasks', { method: 'POST', token: adminToken, body: payload });
      assert.strictEqual(r.status, 200, `Create task ${payload.taskKind} failed: ${JSON.stringify(r.data)}`);
      createdTaskIds.push(r.data.task.id);
      return r.data.task;
    };

    const tSurvey = await createTask({
      title: `E2E-1 استبيان ${randSuffix}`,
      description: 'مهمة استبيان اختبارية',
      category: 'surveys',
      taskKind: 'surveys',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 3,
      taskMeta: { taskKind: 'surveys', difficulty: 'easy', linkedSurveyId: createdSurveyId },
      proofRequirements: { modes: ['multi_question'] },
    });

    const tVideo = await createTask({
      title: `E2E-2 مشاهدة فيديو ${randSuffix}`,
      description: 'شاهد الفيديو لمدة 5 ثوانٍ',
      category: 'social_engagement',
      taskKind: 'video_watch',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 1,
      taskMeta: {
        taskKind: 'video_watch',
        difficulty: 'easy',
        fields: { videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', watchDurationSeconds: 5 },
      },
      proofRequirements: { modes: ['auto_verified'] },
    });

    const tVisit = await createTask({
      title: `E2E-3 زيارة موقع ${randSuffix}`,
      description: 'زر الرابط وأدخل الرمز الظاهر',
      category: 'smart_links',
      taskKind: 'website_visit',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 2,
      taskMeta: {
        taskKind: 'website_visit',
        difficulty: 'medium',
        fields: { targetUrl: 'https://example.com', minVisitSeconds: 5 },
      },
      proofRequirements: { modes: ['auto_verified', 'code_number'] },
    });

    const tFollow = await createTask({
      title: `E2E-4 متابعة حساب ${randSuffix}`,
      description: 'تابع الحساب واكتب اسم المستخدم الخاص بك',
      category: 'social_engagement',
      taskKind: 'social_follow',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 2,
      taskMeta: {
        taskKind: 'social_follow',
        difficulty: 'easy',
        fields: { socialPlatform: 'youtube', socialAccountHandle: '@YemenTaskTest', socialAccountUrl: 'https://youtube.com' },
      },
      proofRequirements: { modes: ['text'], proofPromptText: 'أدخل اسم حسابك في يوتيوب' },
    });

    const tEngage = await createTask({
      title: `E2E-5 تفاعل اجتماعي ${randSuffix}`,
      description: 'إعجاب + اختيار + ملاحظة دون صورة',
      category: 'social_engagement',
      taskKind: 'social_engagement',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 2,
      taskMeta: {
        taskKind: 'social_engagement',
        difficulty: 'medium',
        fields: { socialPlatform: 'instagram', engagementAction: 'like', engagementTargetUrl: 'https://instagram.com' },
      },
      proofRequirements: {
        modes: ['choice', 'text'],
        choiceQuestion: 'ما نوع التفاعل الذي نفذته؟',
        choiceOptions: ['إعجاب فقط', 'إعجاب وتعليق'],
      },
    });

    const tApp = await createTask({
      title: `E2E-6 تجربة تطبيق ${randSuffix}`,
      description: 'تجربة تطبيق وإرفاق رابط',
      category: 'app_testing',
      taskKind: 'app_testing',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 5,
      taskMeta: {
        taskKind: 'app_testing',
        difficulty: 'hard',
        fields: { appDownloadUrl: 'https://play.google.com/store', appRequirements: 'أندرويد 10+' },
      },
      proofRequirements: { modes: ['url', 'text'] },
    });

    const tSignup = await createTask({
      title: `E2E-7 تسجيل حساب آمن ${randSuffix}`,
      description: 'سجل حساباً جديداً وأرسل اسم المستخدم المسجل فقط',
      category: 'local_services',
      taskKind: 'account_signup',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 4,
      taskMeta: {
        taskKind: 'account_signup',
        difficulty: 'medium',
        fields: { partnerName: 'متجر تجريبي', signupUrl: 'https://example.com/register' },
      },
      proofRequirements: { modes: ['text'] },
    });

    const tCustom = await createTask({
      title: `E2E-8 إثبات مخصص ${randSuffix}`,
      description: 'إثبات مخصص برمز وأسئلة متتابعة مدمجة دون صورة',
      category: 'data_entry',
      taskKind: 'custom_proof',
      rewardYer: 1,
      totalQuantity: 1,
      timeEstimateMinutes: 3,
      taskMeta: {
        taskKind: 'custom_proof',
        difficulty: 'hard',
        fields: { customProofSummary: 'أكمل الأسئلة وأدخل الكود' },
      },
      proofRequirements: {
        modes: ['code_number', 'multi_question'],
        customQuestions: [
          { id: 'cq1', surveyId: 'inline', orderIndex: 0, questionText: 'كم التقييم؟', questionType: 'rating_1_5', isRequired: true, options: [] },
          { id: 'cq2', surveyId: 'inline', orderIndex: 1, questionText: 'أدخل عدد الأيام', questionType: 'number', isRequired: true, options: [] },
        ],
      },
    });
    console.log('[4/7] Created all 8 task types + verified account_signup security block');

    // 6. Verify GET /api/tasks returns all 8 tasks with normalized dynamic proofRequirements
    const listRes = await reqJson(baseUrl, '/api/tasks', { token: userToken });
    assert.strictEqual(listRes.status, 200);
    const listedIds = new Set((listRes.data.tasks || []).map((x: any) => x.id));
    for (const tid of createdTaskIds) {
      assert.ok(listedIds.has(tid), `Task ${tid} missing from GET /api/tasks`);
    }
    const fetchedFollow = listRes.data.tasks.find((x: any) => x.id === tFollow.id);
    assert.strictEqual(fetchedFollow.proofRequirements.requireImage, false, 'social_follow should NOT require image');
    assert.strictEqual(fetchedFollow.difficulty, 'easy');
    const fetchedCustom = listRes.data.tasks.find((x: any) => x.id === tCustom.id);
    assert.strictEqual(fetchedCustom.proofRequirements.requireImage, false, 'custom_proof should NOT require image');
    assert.strictEqual(fetchedCustom.difficulty, 'hard');
    console.log('[5/7] Verified GET /api/tasks exposes all 8 types, difficulties, and dynamic proofRequirements');

    // 7. Dynamic submission + Video/Visit execution session verification (ZERO images required!)
    const badFollowSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tFollow.id, proofText: '', proofImages: [] },
    });
    assert.strictEqual(badFollowSub.status, 400);

    const okFollowSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tFollow.id, proofText: '@TestUserHandle', proofImages: [] },
    });
    assert.strictEqual(okFollowSub.status, 200, `Follow submit failed: ${JSON.stringify(okFollowSub.data)}`);

    const okEngageSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tEngage.id, proofChoiceAnswer: 'إعجاب وتعليق', proofText: 'تم التنفيذ بنجاح', proofImages: [] },
    });
    assert.strictEqual(okEngageSub.status, 200, `Engage submit failed: ${JSON.stringify(okEngageSub.data)}`);

    const okCustomSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: {
        taskId: tCustom.id,
        proofCodeNumber: 'YT-9988',
        proofMultiAnswers: { cq1: 5, cq2: '7' },
        proofImages: [],
      },
    });
    assert.strictEqual(okCustomSub.status, 200, `Custom submit failed: ${JSON.stringify(okCustomSub.data)}`);

    const okAppSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tApp.id, proofUrl: 'https://example.com/review/123', proofText: 'تمت تجربة التطبيق', proofImages: [] },
    });
    assert.strictEqual(okAppSub.status, 200);

    const okSignupSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tSignup.id, proofText: 'username_e2e_test', proofImages: [] },
    });
    assert.strictEqual(okSignupSub.status, 200);

    // Video & website visit execution sessions
    const prematureVideo = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tVideo.id, proofImages: [] },
    });
    assert.strictEqual(prematureVideo.status, 400, 'Premature video watch must fail');

    const startVideoSess = await reqJson(baseUrl, `/api/tasks/${tVideo.id}/execution-session/start`, {
      method: 'POST',
      token: userToken,
    });
    assert.strictEqual(startVideoSess.status, 200);
    const videoSessId = startVideoSess.data.session.id;

    const prematureVisit = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tVisit.id, proofCodeNumber: 'VISIT-77', proofImages: [] },
    });
    assert.strictEqual(prematureVisit.status, 400, 'Premature website visit must fail');

    const startVisitSess = await reqJson(baseUrl, `/api/tasks/${tVisit.id}/execution-session/start`, {
      method: 'POST',
      token: userToken,
    });
    assert.strictEqual(startVisitSess.status, 200);
    const visitSessId = startVisitSess.data.session.id;

    await sleep(2700);
    await reqJson(baseUrl, `/api/tasks/${tVideo.id}/execution-session/ping`, {
      method: 'POST',
      token: userToken,
      body: { sessionId: videoSessId, deltaSeconds: 3, isVisible: true },
    });
    await reqJson(baseUrl, `/api/tasks/${tVisit.id}/execution-session/ping`, {
      method: 'POST',
      token: userToken,
      body: { sessionId: visitSessId, deltaSeconds: 3, isVisible: true },
    });

    await sleep(2700);
    const finalVideoPing = await reqJson(baseUrl, `/api/tasks/${tVideo.id}/execution-session/ping`, {
      method: 'POST',
      token: userToken,
      body: { sessionId: videoSessId, deltaSeconds: 3, isVisible: true },
    });
    assert.strictEqual(finalVideoPing.status, 200);
    assert.strictEqual(finalVideoPing.data.session.isCompleted, true);

    const finalVisitPing = await reqJson(baseUrl, `/api/tasks/${tVisit.id}/execution-session/ping`, {
      method: 'POST',
      token: userToken,
      body: { sessionId: visitSessId, deltaSeconds: 3, isVisible: true },
    });
    assert.strictEqual(finalVisitPing.status, 200);
    assert.strictEqual(finalVisitPing.data.session.isCompleted, true);

    const okVideoSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tVideo.id, executionSessionId: videoSessId, proofImages: [] },
    });
    assert.strictEqual(okVideoSub.status, 200, `Verified video submit failed: ${JSON.stringify(okVideoSub.data)}`);

    const okVisitSub = await reqJson(baseUrl, '/api/tasks/submit', {
      method: 'POST',
      token: userToken,
      body: { taskId: tVisit.id, executionSessionId: visitSessId, proofCodeNumber: 'VISIT-77', proofImages: [] },
    });
    assert.strictEqual(okVisitSub.status, 200, `Verified visit submit failed: ${JSON.stringify(okVisitSub.data)}`);

    const mySubs = await reqJson(baseUrl, '/api/submissions/my', { token: userToken });
    assert.strictEqual(mySubs.status, 200);
    const customSubRecord = mySubs.data.submissions.find((s: any) => s.taskId === tCustom.id);
    assert.strictEqual(customSubRecord?.proofCodeNumber, 'YT-9988');
    assert.ok(Array.isArray(customSubRecord?.proofMultiAnswers) && customSubRecord.proofMultiAnswers.length === 2);
    const engageSubRecord = mySubs.data.submissions.find((s: any) => s.taskId === tEngage.id);
    assert.strictEqual(engageSubRecord?.proofChoiceAnswer, 'إعجاب وتعليق');

    assert.ok(tSurvey.id);
    console.log('[6/7] Verified flexible non-image proofs, execution sessions, and structured submissions retrieval');
  } finally {
    for (const tid of createdTaskIds) {
      if (adminToken) {
        await reqJson(baseUrl, `/api/admin/tasks/${tid}`, { method: 'DELETE', token: adminToken }).catch(() => {});
      }
    }
    if (createdSurveyId && adminToken) {
      await reqJson(baseUrl, `/api/admin/surveys/${createdSurveyId}`, { method: 'DELETE', token: adminToken }).catch(() => {});
    }
    await cleanupDisposableUser(adminClient, testUserId);
    await cleanupDisposableUser(adminClient, testAdminId);
    server.close();
  }

  const afterTreasury = await getTreasurySnapshot();
  console.log(`[7/7] Post-cleanup treasury snapshot:`, afterTreasury);
  assert.strictEqual(
    afterTreasury.treasuryAvailable.toFixed(6),
    beforeTreasury.treasuryAvailable.toFixed(6),
    `Treasury available mismatch! Before=${beforeTreasury.treasuryAvailable}, After=${afterTreasury.treasuryAvailable}`
  );
  assert.strictEqual(
    afterTreasury.taskBudgetReserved.toFixed(6),
    beforeTreasury.taskBudgetReserved.toFixed(6),
    `Task budget reserved mismatch! Before=${beforeTreasury.taskBudgetReserved}, After=${afterTreasury.taskBudgetReserved}`
  );
  assert.strictEqual(afterTreasury.isReconciled, beforeTreasury.isReconciled, 'Ledger reconciliation status changed!');
  console.log('ALL_E2E_CHECKS_PASSED_CLEANLY');
}

main().catch((err) => {
  console.error('E2E_FAILED:', err);
  process.exit(1);
});
