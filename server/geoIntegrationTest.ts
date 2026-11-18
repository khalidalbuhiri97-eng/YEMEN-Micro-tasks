/**
 * Automated Integration & Integrity Test Suite for Yemen Task Arab League Geography System (22 Countries)
 * Verifies:
 *   1. Presence & active ordering of all 22 Arab League member states (YE..KM) and official admin levels
 *   2. 100% real open-source dataset integrity (3,993 divisions: bilingual names, zero cycles, zero orphans, provenance)
 *   3. Recursive hierarchy expansion (expandDivisionAndDescendants) & cross-country rejection (validateGeoSelection)
 *   4. Real Express HTTP API public geo endpoints + strict 401 RBAC guards on admin & profile location routes
 *   5. Migration 028/029 SQL consistency & strict financial invariance (YER, ledger, campaigns, payout methods)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import app from './app.js';
import { geoService } from './geoService.js';
import { supabaseDb } from './supabaseDb.js';
import { calculateCampaignFeePolicyCosts } from '../shared/money.js';

const EXPECTED_ARAB_LEAGUE_ISO2 = [
  'YE', 'SA', 'AE', 'KW', 'QA', 'BH', 'OM', 'IQ', 'JO', 'PS', 'SY',
  'LB', 'EG', 'SD', 'LY', 'TN', 'DZ', 'MA', 'MR', 'SO', 'DJ', 'KM',
] as const;

async function testDatasetAndCountries() {
  console.log('\n[1/5] Verifying 22 Arab League Countries, Official Admin Levels & Division Counts...');

  const { countries } = await geoService.getCountries({ includeInactive: true });
  assert.strictEqual(countries.length, 22, `Expected 22 Arab League countries, got ${countries.length}`);

  const actualIso2 = countries.map((c) => c.iso2);
  assert.deepStrictEqual(
    actualIso2,
    [...EXPECTED_ARAB_LEAGUE_ISO2],
    `Expected exact YE..KM ordering, got ${actualIso2.join(',')}`
  );

  for (const c of countries) {
    assert.ok(c.isActive, `Country ${c.iso2} (${c.nameAr}) must be active`);
    assert.ok(c.nameAr.trim().length > 0 && c.nameEn.trim().length > 0, `Missing names for ${c.iso2}`);

    const levels = await geoService.getCountryLevels(c.id);
    assert.ok(levels.length >= 2, `Country ${c.iso2} must have at least 2 admin levels, got ${levels.length}`);
    for (let i = 0; i < levels.length; i++) {
      assert.strictEqual(levels[i].levelOrder, i + 1, `${c.iso2} level order mismatch`);
    }
  }

  // Spot-check country-specific Arabic administrative terminology
  const yeLevels = await geoService.getCountryLevels('YE');
  assert.deepStrictEqual(
    yeLevels.map((l) => l.nameAr),
    ['المحافظة', 'المديرية']
  );
  const saLevels = await geoService.getCountryLevels('SA');
  assert.deepStrictEqual(
    saLevels.map((l) => l.nameAr),
    ['المنطقة الإدارية', 'المحافظة']
  );
  const omLevels = await geoService.getCountryLevels('OM');
  assert.deepStrictEqual(
    omLevels.map((l) => l.nameAr),
    ['المحافظة', 'الولاية']
  );
  const syLevels = await geoService.getCountryLevels('SY');
  assert.deepStrictEqual(
    syLevels.map((l) => l.nameAr),
    ['المحافظة', 'المنطقة', 'الناحية']
  );
  const mrLevels = await geoService.getCountryLevels('MR');
  assert.deepStrictEqual(
    mrLevels.map((l) => l.nameAr),
    ['الولاية', 'المقاطعة']
  );

  console.log('  - All 22 countries active in order (YE..KM) with official per-country admin terminology.');
}

async function testHierarchyIntegrityAndCounts() {
  console.log('\n[2/5] Running Full Hierarchy Integrity Audit (3,993 Divisions, Zero Cycles/Orphans)...');

  const integrity = await geoService.getAdminGeoIntegrity();
  assert.strictEqual(integrity.totalCountries, 22, `Expected 22 countries, got ${integrity.totalCountries}`);
  assert.strictEqual(integrity.activeCountries, 22, `Expected 22 active countries, got ${integrity.activeCountries}`);
  assert.strictEqual(integrity.totalLevels, 45, `Expected 45 official admin levels, got ${integrity.totalLevels}`);
  assert.strictEqual(integrity.totalDivisions, 3993, `Expected 3,993 real divisions, got ${integrity.totalDivisions}`);
  assert.strictEqual(integrity.isHealthy, true, `Geo integrity failed: ${JSON.stringify(integrity.checks)}`);
  assert.deepStrictEqual(integrity.checks.countriesMissingDivisions, []);
  assert.strictEqual(integrity.checks.missingNamesCount, 0);
  assert.strictEqual(integrity.checks.crossCountryParentCount, 0);
  assert.strictEqual(integrity.checks.invalidLevelOrderCount, 0);
  assert.strictEqual(integrity.checks.cyclesCount, 0);
  assert.strictEqual(integrity.checks.duplicateCodeCount, 0);
  assert.strictEqual(integrity.checks.duplicateSiblingCount, 0);

  // Verify open-source provenance on raw dataset
  const datasetPath = path.resolve(process.cwd(), 'data', 'arab-geography.json');
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  for (const div of raw.divisions) {
    assert.ok(div.data_source && String(div.data_source).trim().length > 0, `Missing data_source on ${div.id}`);
    assert.ok(div.data_license && String(div.data_license).trim().length > 0, `Missing data_license on ${div.id}`);
    assert.notStrictEqual(div.parent_id, div.id, `Self-parent on ${div.id}`);
  }

  const overview = await geoService.getAdminGeoOverview();
  const countsSummary = overview.countries.map((c: any) => `${c.iso2}:${c.divisionsCount}`).join(', ');
  console.log(`  - Verified 3,993 divisions, 45 levels, isHealthy=true. Counts: ${countsSummary}`);
}

async function testCascadingExpansionAndValidation() {
  console.log('\n[3/5] Verifying Recursive Descendant Expansion & Cross-Country Rejection...');

  // 1. Yemen multi-level expansion (Governorate -> Districts)
  const yeGovs = await geoService.getDivisions({ countryId: 'YE', parentId: null });
  assert.ok(yeGovs.length >= 21, `Expected 21+ Yemeni governorates, got ${yeGovs.length}`);
  const sanaaGov = yeGovs.find((g) => g.nameEn.includes('Sana') || g.nameAr.includes('صنعاء'));
  assert.ok(sanaaGov, 'Expected Sanaa governorate in Yemen level 1');

  const yeChildren = await geoService.getDivisionChildren(sanaaGov.id);
  assert.ok(yeChildren.length > 0, 'Sanaa governorate must have districts');

  const yeExpanded = await geoService.expandDivisionAndDescendants(sanaaGov.id);
  assert.ok(yeExpanded.includes(sanaaGov.id), 'Expanded list must include root division');
  assert.ok(
    yeExpanded.length >= 1 + yeChildren.length,
    `Expanded YE must include parent + districts, got ${yeExpanded.length}`
  );

  // 2. Syria 3-level expansion (Governorate L1 -> District L2 -> Sub-district L3)
  const syGovs = await geoService.getDivisions({ countryId: 'SY', parentId: null });
  assert.ok(syGovs.length >= 14, `Expected 14 Syrian governorates, got ${syGovs.length}`);
  const syGovWithTree = syGovs[0];
  const syL2 = await geoService.getDivisionChildren(syGovWithTree.id);
  assert.ok(syL2.length > 0, 'Syria governorate must have L2 districts');
  const syL3 = await geoService.getDivisionChildren(syL2[0].id);
  assert.ok(syL3.length > 0, 'Syria L2 district must have L3 sub-districts');

  const syExpanded = await geoService.expandDivisionAndDescendants(syGovWithTree.id);
  assert.ok(syExpanded.includes(syGovWithTree.id));
  assert.ok(syExpanded.includes(syL2[0].id));
  assert.ok(syExpanded.includes(syL3[0].id), 'Recursive expansion must reach L3 sub-districts');

  // Verify full path resolution for L3 node
  const pathRes = await geoService.getDivisionPath(syL3[0].id);
  assert.strictEqual(pathRes.path.length, 3, `Expected 3-step path for SY L3 node, got ${pathRes.path.length}`);

  // 3. Cross-country mismatch validation must reject
  const countriesResp = await geoService.getCountries({ includeInactive: false });
  const ye = countriesResp.countries.find((c) => c.iso2 === 'YE')!;
  const eg = countriesResp.countries.find((c) => c.iso2 === 'EG')!;
  const egDivs = await geoService.getDivisions({ countryId: eg.id, parentId: null });
  assert.ok(egDivs.length > 0, 'Egypt must have governorates');

  await assert.rejects(
    async () => {
      await geoService.validateGeoSelection({
        countryId: ye.id,
        divisionId: egDivs[0].id,
      });
    },
    /لا يتبع الدولة المختارة/,
    'validateGeoSelection must reject division from EG when country is YE'
  );

  await assert.rejects(
    async () => {
      await geoService.validateGeoSelection({
        countryId: ye.id,
        divisionIds: [egDivs[0].id],
      });
    },
    /لا ينتمي إلى الدولة المحددة/,
    'validateGeoSelection must reject multi-target divisionIds from wrong country'
  );

  const validSel = await geoService.validateGeoSelection({
    countryId: ye.id,
    divisionId: yeChildren[0].id,
  });
  assert.strictEqual(validSel.country?.iso2, 'YE');
  assert.strictEqual(validSel.division?.id, yeChildren[0].id);
  assert.ok(validSel.locationPath?.includes('اليمن'), 'Resolved locationPath must contain country name');

  console.log(
    `  - Verified YE recursive expansion (${yeExpanded.length} nodes), SY 3-level expansion (${syExpanded.length} nodes) & cross-country guard.`
  );
}

async function testExpressHttpEndpointsAndRbac() {
  console.log('\n[4/5] Testing Live Express HTTP /api/geo/* Routes & Admin 401 RBAC Guards...');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // Public countries endpoint
    const cResp = await fetch(`${baseUrl}/api/geo/countries`);
    assert.strictEqual(cResp.status, 200, 'GET /api/geo/countries must return 200');
    const cJson = await cResp.json();
    assert.strictEqual(cJson.countries.length, 22, 'HTTP /api/geo/countries must return 22 countries');

    // Public levels endpoint
    const lResp = await fetch(`${baseUrl}/api/geo/countries/YE/levels`);
    assert.strictEqual(lResp.status, 200);
    const lJson = await lResp.json();
    assert.strictEqual(lJson.levels.length, 2);
    assert.strictEqual(lJson.levels[0].nameAr, 'المحافظة');
    assert.strictEqual(lJson.levels[1].nameAr, 'المديرية');

    // Public divisions endpoint requires countryId
    const badDivResp = await fetch(`${baseUrl}/api/geo/divisions`);
    assert.strictEqual(badDivResp.status, 400, 'GET /api/geo/divisions without countryId must return 400');

    // Public divisions by countryId
    const yeDivResp = await fetch(`${baseUrl}/api/geo/divisions?countryId=YE`);
    assert.strictEqual(yeDivResp.status, 200);
    const yeDivJson = await yeDivResp.json();
    assert.ok(yeDivJson.divisions.length >= 21);

    const firstDivId = yeDivJson.divisions[0].id;
    const chResp = await fetch(`${baseUrl}/api/geo/divisions/${firstDivId}/children`);
    assert.strictEqual(chResp.status, 200);
    const chJson = await chResp.json();
    assert.ok(Array.isArray(chJson.divisions) && chJson.divisions.length > 0);

    const pathResp = await fetch(`${baseUrl}/api/geo/divisions/${chJson.divisions[0].id}/path`);
    assert.strictEqual(pathResp.status, 200);
    const pathJson = await pathResp.json();
    assert.strictEqual(pathJson.path.length, 2);

    // Protected endpoints must reject unauthenticated requests with 401
    const protectedGeoRoutes: Array<[string, string]> = [
      ['PUT', '/api/profile/location'],
      ['GET', '/api/admin/geo/overview'],
      ['GET', '/api/admin/geo/integrity'],
      ['PATCH', '/api/admin/geo/countries/YE'],
      ['POST', '/api/admin/geo/countries/YE/levels'],
      ['POST', '/api/admin/geo/divisions'],
      ['PUT', `/api/admin/geo/divisions/${firstDivId}`],
      ['POST', '/api/admin/geo/countries/YE/import'],
    ];

    for (const [method, routePath] of protectedGeoRoutes) {
      const r = await fetch(`${baseUrl}${routePath}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({}),
      });
      assert.strictEqual(r.status, 401, `Unauthenticated ${method} ${routePath} must return 401, got ${r.status}`);
    }

    console.log(
      `  - Public HTTP /api/geo/* verified & ${protectedGeoRoutes.length} protected geo routes enforced 401.`
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function testSqlSchemaAlignmentAndFinancialInvariance() {
  console.log('\n[5/5] Auditing Migrations 028 & 029 SQL Column Alignment + Financial Invariance...');

  const sql028 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/028_arab_countries_geography.sql'),
    'utf8'
  );
  const sql029 = fs.readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/029_arab_countries_geography_seed.sql'),
    'utf8'
  );

  // Verify 028 creates required tables, triggers & helper functions
  for (const tbl of [
    'public.countries',
    'public.country_admin_levels',
    'public.administrative_divisions',
    'public.task_target_divisions',
    'public.campaign_target_divisions',
  ]) {
    assert.ok(sql028.includes(`CREATE TABLE IF NOT EXISTS ${tbl}`), `028 missing ${tbl}`);
  }
  assert.ok(sql028.includes('get_division_descendant_ids'), '028 missing get_division_descendant_ids');
  assert.ok(sql028.includes('validate_administrative_division_hierarchy'), '028 missing hierarchy trigger');
  assert.ok(sql028.includes('backfill_arab_geography_legacy_links'), '028 missing legacy backfill helper');
  assert.ok(sql028.includes('CREATE OR REPLACE FUNCTION public.handle_new_user'), '028 must keep handle_new_user intact');

  // Verify 029 exact INSERT column alignment with 028 DDL
  assert.ok(
    sql029.includes(
      'INSERT INTO public.countries (id, iso2, iso3, name_ar, name_en, phone_code, flag_emoji, is_active, sort_order, data_source, data_license, last_synced_at)'
    ),
    '029 countries INSERT columns must match 028 DDL'
  );
  assert.ok(
    sql029.includes(
      'INSERT INTO public.country_admin_levels (id, country_id, level_order, name_ar, name_en, plural_ar, is_required, is_active)'
    ),
    '029 country_admin_levels INSERT columns must match 028 DDL'
  );
  assert.ok(!sql029.includes('currency_code'), '028/029 must not introduce non-YER currency_code on countries');
  assert.ok(!sql028.includes('currency_code'), '028 must preserve single-currency YER architecture');

  // Financial system invariance checks
  const settings = await supabaseDb.getSettings();
  assert.strictEqual(settings.referralBonus, 30, 'referralBonus must stay 30 YER');
  assert.strictEqual(settings.advertiserCampaignFeePercentage, 20, 'Campaign fee must stay 20%');

  const campaignCalc = calculateCampaignFeePolicyCosts({
    rewardUnits: 100,
    slots: 50,
    policy: { defaultPercentage: 20 },
  });
  assert.strictEqual(campaignCalc.budgetUnits, 5000);
  assert.strictEqual(campaignCalc.feeUnits, 1000);
  assert.strictEqual(campaignCalc.totalUnits, 6000);

  const serverAppSrc = fs.readFileSync(path.resolve(process.cwd(), 'server/app.ts'), 'utf8');
  assert.ok(serverAppSrc.includes("currency: 'YER'"), 'System currency must remain YER');
  for (const method of ['KURAIMI', 'NAJM', 'JAWALI', 'ONE_CASH']) {
    assert.ok(
      fs.readFileSync(path.resolve(process.cwd(), 'server/supabaseDb.ts'), 'utf8').includes(method),
      `Withdrawal method ${method} must remain intact`
    );
  }

  console.log('  - Migrations 028/029 schema match verified & YER financial/ledger invariance preserved.');
}

async function main() {
  console.log('==================================================================');
  console.log(' Yemen Task - Arab League Geography (22 States) Integration Suite  ');
  console.log('==================================================================');

  await testDatasetAndCountries();
  await testHierarchyIntegrityAndCounts();
  await testCascadingExpansionAndValidation();
  await testExpressHttpEndpointsAndRbac();
  await testSqlSchemaAlignmentAndFinancialInvariance();

  console.log('\nALL ARAB GEOGRAPHY INTEGRATION TESTS PASSED (5/5).');
}

main().catch((err) => {
  console.error('\n[GEO_INTEGRATION_TEST_FAILED]', err);
  process.exit(1);
});
