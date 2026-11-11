import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../api/client.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import type { SystemErrorLog, DatabaseMonitoringStats, ErrorType, ErrorAggregationGroup } from '../../types/index.ts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  Clock,
  Database,
  ShieldAlert,
  Server,
  Terminal,
  Check,
  Zap,
  Info,
  Layers,
  ArrowUpDown,
  Calendar,
  Eye,
  FileCode,
  X,
  Send,
  AlertCircle,
  BarChart3,
  TrendingUp,
  Table,
  ArrowRight,
  ChevronLeft,
  SlidersHorizontal,
  Flame,
} from 'lucide-react';

const ERROR_TYPE_LABELS: Record<string, { labelAr: string; color: string }> = {
  NETWORK_CONNECTION: { labelAr: 'انقطاع الشبكة والاتصال', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  AUTHENTICATION: { labelAr: 'أخطاء المصادقة (Auth)', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20' },
  PERMISSIONS_RLS: { labelAr: 'أخطاء الصلاحيات وRLS', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20' },
  MISSING_TABLE_COLUMN: { labelAr: 'جدول أو عمود غير موجود', color: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20' },
  CONSTRAINT_VIOLATION: { labelAr: 'قيود UNIQUE وForeign Key', color: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20' },
  POSTGRES_INTERNAL: { labelAr: 'أخطاء PostgreSQL الداخلية', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20' },
  RPC_FUNCTION_ERROR: { labelAr: 'أخطاء دوال RPC', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20' },
  DATA_WRITE_ERROR: { labelAr: 'أخطاء كتابة البيانات (Insert/Update)', color: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20' },
  DATA_READ_ERROR: { labelAr: 'أخطاء قراءة البيانات (Select)', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20' },
  STORAGE_ERROR: { labelAr: 'أخطاء التخزين (Storage)', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20' },
  TIMEOUT_ERROR: { labelAr: 'انتهاء المهلة (Timeout)', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20' },
  UNKNOWN_ERROR: { labelAr: 'أخطاء غير معروفة', color: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20' },
};

export const DatabaseErrorsView: React.FC = () => {
  const { showToast } = useAuth();
  const [logs, setLogs] = useState<SystemErrorLog[]>([]);
  const [aggregations, setAggregations] = useState<ErrorAggregationGroup[]>([]);
  const [stats, setStats] = useState<DatabaseMonitoringStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);

  // Active View Mode: 'aggregated' (Bottleneck analysis) or 'detailed' (Individual log records)
  const [viewMode, setViewMode] = useState<'aggregated' | 'detailed'>('aggregated');

  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedErrorType, setSelectedErrorType] = useState<string>('ALL');
  const [selectedTable, setSelectedTable] = useState<string>('ALL');
  const [resolvedStatus, setResolvedStatus] = useState<string>('unresolved'); // 'all' | 'unresolved' | 'resolved'
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Selected Log for Safe Inspection Drawer
  const [selectedLog, setSelectedLog] = useState<SystemErrorLog | null>(null);
  const [resolutionNote, setResolutionNote] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  // Unique list of source tables extracted from logs and aggregations for dropdown
  const uniqueTables = useMemo(() => {
    const tableSet = new Set<string>();
    tableSet.add('platform_settings');
    tableSet.add('profiles');
    tableSet.add('wallets');
    tableSet.add('tasks');
    tableSet.add('task_submissions');
    tableSet.add('wallet_transactions');
    tableSet.add('withdrawals');
    tableSet.add('system_error_logs');
    tableSet.add('general');

    logs.forEach(l => {
      if (l.sourceTable) tableSet.add(l.sourceTable);
      if (l.sourceFunction) tableSet.add(l.sourceFunction);
    });
    aggregations.forEach(a => {
      if (a.sourceTable) tableSet.add(a.sourceTable);
    });

    return Array.from(tableSet);
  }, [logs, aggregations]);

  const fetchLogsAndStats = async () => {
    setIsLoading(true);
    try {
      const res = await api.getDatabaseErrors({
        search: searchQuery || undefined,
        errorType: selectedErrorType !== 'ALL' ? selectedErrorType : undefined,
        sourceTable: selectedTable !== 'ALL' ? selectedTable : undefined,
        resolvedStatus,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });

      const fetchedLogs: SystemErrorLog[] = res.logs || [];
      setLogs(fetchedLogs);
      setStats(res.stats || null);

      if (res.aggregations && res.aggregations.length > 0) {
        setAggregations(res.aggregations);
      } else {
        // Fallback aggregation client-side if server didn't provide it
        const map: Record<string, ErrorAggregationGroup> = {};
        fetchedLogs.forEach((l) => {
          const type = l.errorType || 'UNKNOWN_ERROR';
          const table = l.sourceTable || l.sourceFunction || 'general';
          const key = `${type}___${table}`;
          if (!map[key]) {
            map[key] = {
              errorType: type,
              sourceTable: table,
              count: 0,
              unresolvedCount: 0,
              lastOccurredAt: l.occurredAt,
              sampleMessage: l.message,
              sampleCode: l.errorCode,
            };
          }
          map[key].count += 1;
          if (!l.resolved) map[key].unresolvedCount += 1;
          if (new Date(l.occurredAt).getTime() > new Date(map[key].lastOccurredAt).getTime()) {
            map[key].lastOccurredAt = l.occurredAt;
            map[key].sampleMessage = l.message;
            map[key].sampleCode = l.errorCode;
          }
        });
        setAggregations(Object.values(map).sort((a, b) => b.count - a.count));
      }
    } catch (err: any) {
      showToast(err.message || 'فشل في جلب سجل مراقبة أخطاء قاعدة البيانات', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogsAndStats();
  }, [selectedErrorType, selectedTable, resolvedStatus, startDate, endDate]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLogsAndStats();
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testSupabaseConnection();
      setTestResult(res);
      if (res.isConnected) {
        showToast(`الاتصال ناجح مع Supabase Cloud! زمن الاستجابة: ${res.pingMs} ms`, 'success');
      } else {
        showToast(res.statusText || 'فشل الاتصال بقاعدة البيانات', 'error');
      }
      await fetchLogsAndStats();
    } catch (err: any) {
      showToast(err.message || 'تعذر إجراء فحص الاتصال', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleResolveLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLog) return;

    setIsResolving(true);
    try {
      await api.resolveDatabaseError(selectedLog.id, resolutionNote);
      showToast('تم تمييز الخطأ كـ تم الحل وتحديث حالة المعالجة بنجاح.', 'success');
      setSelectedLog(null);
      setResolutionNote('');
      await fetchLogsAndStats();
    } catch (err: any) {
      showToast(err.message || 'فشل في تحديث حالة المعالجة للخطأ', 'error');
    } finally {
      setIsResolving(false);
    }
  };

  const handleFilterByGroup = (errorType: string, sourceTable: string) => {
    setSelectedErrorType(errorType);
    setSelectedTable(sourceTable);
    setViewMode('detailed');
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedErrorType('ALL');
    setSelectedTable('ALL');
    setResolvedStatus('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-slate-900 text-white shadow-lg border border-slate-800 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1">
              <Activity className="w-4 h-4 animate-pulse" />
              <span>مركز مراقبة وتشخيص قاعدة البيانات – DATABASE MONITORING</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2">
              <span>أخطاء وسجلات Supabase Cloud PostgreSQL</span>
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              تتبع زمني وحي لأداء الجداول، الاستعلامات، واستدعاءات RPC والمصادقة دون تخزين أي بيانات حساسة أو مفاتيح سرية.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleTestConnection}
              disabled={isTesting}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Zap className={`w-4 h-4 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'جارِ فحص الشبكة...' : 'اختبار اتصال Supabase'}</span>
            </button>

            <button
              onClick={fetchLogsAndStats}
              disabled={isLoading}
              className="px-3.5 py-2.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl transition-colors flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>تحديث السجلات</span>
            </button>
          </div>
        </div>
      </div>

      {/* Connection Test Result Box */}
      {testResult && (
        <div
          className={`p-4 rounded-2xl border text-xs font-medium flex items-start justify-between gap-4 transition-all ${
            testResult.isConnected
              ? 'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
          }`}
        >
          <div className="flex items-start gap-3">
            {testResult.isConnected ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <div className="font-bold text-sm">{testResult.statusText}</div>
              <div className="flex items-center gap-4 text-[11px] opacity-80 font-mono">
                <span>زمن الاستجابة (Ping): {testResult.pingMs} ms</span>
                <span>وقت الفحص: {new Date(testResult.checkedAt).toLocaleTimeString('ar-YE')}</span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setTestResult(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 opacity-60 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Real-time Status & Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Status Card */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-500 font-semibold">حالة الاتصال بـ Supabase</span>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                stats?.isConnected ? 'bg-emerald-500 animate-ping' : 'bg-rose-500'
              }`}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-extrabold text-slate-900 dark:text-white">
              {stats?.isConnected ? 'متصل بنجاح' : 'غير متصل أو مقيد'}
            </span>
            {stats?.pingMs !== undefined && (
              <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
                ({stats.pingMs} ms)
              </span>
            )}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 flex items-center gap-1 font-mono">
            <Clock className="w-3 h-3" />
            <span>آخر نجاح: {stats?.lastSuccessfulConnection ? new Date(stats.lastSuccessfulConnection).toLocaleTimeString('ar-YE') : '---'}</span>
          </div>
        </div>

        {/* 24h Errors */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs text-slate-500 block mb-1 font-semibold">الأخطاء خلال آخر 24 ساعة</span>
          <div className="text-2xl font-black font-mono tabular-nums text-rose-600 dark:text-rose-400">
            {stats?.errors24h || 0}
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            من إجمالي {stats?.errors7d || 0} خطأ خلال آخر 7 أيام
          </div>
        </div>

        {/* Operations Ratio */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs text-slate-500 block mb-1 font-semibold">العمليات الناجحة vs الفاشلة</span>
          <div className="flex items-center gap-2 font-mono text-base font-bold">
            <span className="text-emerald-600 dark:text-emerald-400">✓ {stats?.totalSuccessfulOps || 0}</span>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-rose-600 dark:text-rose-400">✗ {stats?.totalFailedOps || 0}</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2">
            معدل نجاح العمليات: {
              stats && (stats.totalSuccessfulOps + stats.totalFailedOps) > 0
                ? Math.round((stats.totalSuccessfulOps / (stats.totalSuccessfulOps + stats.totalFailedOps)) * 100)
                : 100
            }%
          </div>
        </div>

        {/* Last Error Timestamp */}
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
          <span className="text-xs text-slate-500 block mb-1 font-semibold">آخر خطأ تم تسجيله</span>
          <div className="text-xs font-bold font-mono text-slate-900 dark:text-white truncate" title={stats?.lastErrorTimestamp || 'لا يوجد'}>
            {stats?.lastErrorTimestamp ? new Date(stats.lastErrorTimestamp).toLocaleString('ar-YE') : 'لا توجد أخطاء مسجلة'}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 truncate" title={stats?.lastFailedOp?.message || ''}>
            {stats?.lastFailedOp ? `${stats.lastFailedOp.operation}: ${stats.lastFailedOp.message}` : 'النظام يعمل بشكل ممتاز'}
          </div>
        </div>
      </div>

      {/* Error Category Badges Bar */}
      {stats?.errorTypeBreakdown && Object.keys(stats.errorTypeBreakdown).length > 0 && (
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
          <div className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-emerald-600" />
            <span>توزيع الأخطاء حسب التصنيف الأكاديمي:</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {Object.entries(stats.errorTypeBreakdown).map(([type, count]) => {
              const meta = ERROR_TYPE_LABELS[type] || { labelAr: type, color: 'bg-slate-100 text-slate-700' };
              return (
                <button
                  key={type}
                  onClick={() => setSelectedErrorType(type)}
                  className={`px-3 py-1 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${meta.color} ${
                    selectedErrorType === type ? 'ring-2 ring-emerald-500 shadow-sm' : ''
                  }`}
                >
                  <span>{meta.labelAr}</span>
                  <span className="px-1.5 py-0.2 rounded-full font-mono text-[10px] bg-black/10 dark:bg-white/10">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Search & Filtering Control Panel */}
      <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
        <form onSubmit={handleSearchSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search Box */}
          <div className="lg:col-span-2 relative">
            <Search className="w-4 h-4 absolute right-3 top-3 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="ابحث بالنص، اسم الجدول، الدالة، أو رمز الخطأ..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pr-9 pl-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
            />
          </div>

          {/* Error Type Filter */}
          <div>
            <select
              value={selectedErrorType}
              onChange={(e) => setSelectedErrorType(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none"
            >
              <option value="ALL">جميع التصنيفات</option>
              {Object.entries(ERROR_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.labelAr}</option>
              ))}
            </select>
          </div>

          {/* Source Table Filter */}
          <div>
            <select
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none font-mono"
            >
              <option value="ALL">جميع الجداول / المصادر</option>
              {uniqueTables.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          {/* Resolution Status Filter */}
          <div>
            <select
              value={resolvedStatus}
              onChange={(e) => setResolvedStatus(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none"
            >
              <option value="all">جميع الحالات</option>
              <option value="unresolved">غير معالج (جديد / معلق)</option>
              <option value="resolved">تم الحل والمعالجة</option>
            </select>
          </div>

          {/* Filter Submit Button */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-1.5"
            >
              <Filter className="w-3.5 h-3.5" />
              <span>تطبيق</span>
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs rounded-xl transition-colors"
            >
              إعادة ضبط
            </button>
          </div>
        </form>
      </div>

      {/* View Switcher Tabs: Error Aggregation (Bottlenecks) vs Detailed Logs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 p-2 bg-slate-100 dark:bg-slate-800/80 rounded-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('aggregated')}
            className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              viewMode === 'aggregated'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm border border-slate-200/60 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <BarChart3 className="w-4 h-4 text-emerald-500" />
            <span>تجميع الأخطاء ونقاط الاختناق (Error Aggregation)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              {aggregations.length}
            </span>
          </button>

          <button
            onClick={() => setViewMode('detailed')}
            className={`flex-1 sm:flex-initial px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
              viewMode === 'detailed'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm border border-slate-200/60 dark:border-slate-700'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Table className="w-4 h-4 text-blue-500" />
            <span>سجل الأخطاء التفصيلي (Detailed Logs)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {logs.length}
            </span>
          </button>
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 px-3 flex items-center gap-2">
          {viewMode === 'aggregated' ? (
            <span className="flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-500 shrink-0" />
              <span>مجمعة حسب <strong>نوع الخطأ (error_type)</strong> و<strong>الجدول (source_table)</strong> لكشف الاختناقات وتكرارها</span>
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <FileCode className="w-4 h-4 text-slate-400 shrink-0" />
              <span>سجل زمني مفصل لكل استثناء حدث مع تفاصيل رسالة الخطأ الأصلية</span>
            </span>
          )}
        </div>
      </div>

      {/* VIEW 1: ERROR AGGREGATION & BOTTLENECK ANALYSIS */}
      {viewMode === 'aggregated' && (
        <div className="space-y-4">
          {/* Aggregation Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 block mb-1 font-semibold flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-500" />
                <span>إجمالي مجموعات الاختناق</span>
              </span>
              <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                {aggregations.length}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                مجموعات متميزة من تصنيف الخطأ والجدول
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 block mb-1 font-semibold flex items-center gap-1.5">
                <Flame className="w-3.5 h-3.5 text-rose-500" />
                <span>أعلى نقطة اختناق تكراراً</span>
              </span>
              <div className="text-sm font-extrabold text-rose-600 dark:text-rose-400 truncate" title={aggregations[0] ? `${aggregations[0].sourceTable} (${aggregations[0].count})` : 'لا يوجد'}>
                {aggregations[0] ? `${aggregations[0].sourceTable}` : 'لا توجد أخطاء'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1 truncate">
                {aggregations[0]
                  ? `${aggregations[0].count} تكرار • ${ERROR_TYPE_LABELS[aggregations[0].errorType]?.labelAr || aggregations[0].errorType}`
                  : 'النظام سليم بالكامل'}
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 block mb-1 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span>الأخطاء المعلقة غير المعالجة</span>
              </span>
              <div className="text-2xl font-black font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {aggregations.reduce((acc, g) => acc + g.unresolvedCount, 0)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                من إجمالي {logs.length} خطأ مسجل
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500 block mb-1 font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                <span>إجمالي استثناءات المجموعات</span>
              </span>
              <div className="text-2xl font-black font-mono tabular-nums text-slate-900 dark:text-white">
                {aggregations.reduce((acc, g) => acc + g.count, 0)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                تكرار استعلامات تم تسجيلها
              </div>
            </div>
          </div>

          {/* Aggregated Bottlenecks Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-emerald-600" />
                  <span>جدول تجميع الأخطاء حسب التصنيف والجدول (Error Aggregation Table)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  مرتب تنازلياً حسب كثافة التكرار لاكتشاف مواطن الضعف الأكثر تأثيراً على أداء النظام
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                  <tr>
                    <th className="py-3.5 px-4">نوع وتصنيف الخطأ (Error Type)</th>
                    <th className="py-3.5 px-4">الجدول / المصدر (Source Table)</th>
                    <th className="py-3.5 px-4 text-center">التكرار (Count)</th>
                    <th className="py-3.5 px-4 text-center">الحالة المعلقة</th>
                    <th className="py-3.5 px-4">أحدث رسالة خطأ مسجلة</th>
                    <th className="py-3.5 px-4">آخر حدوث</th>
                    <th className="py-3.5 px-4 text-left">الإجراء التشخيصي</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                        <span>جارِ تجميع وتحليل سجلات الأخطاء...</span>
                      </td>
                    </tr>
                  ) : aggregations.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400 space-y-2">
                        <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto opacity-80" />
                        <div className="font-bold text-slate-700 dark:text-slate-300">
                          لا توجد اختناقات مسجلة حالياً
                        </div>
                        <div className="text-xs">
                          جميع استعلامات وتكاملات Supabase تعمل ضمن المعدلات الطبيعية.
                        </div>
                      </td>
                    </tr>
                  ) : (
                    aggregations.map((group, idx) => {
                      const meta = ERROR_TYPE_LABELS[group.errorType] || {
                        labelAr: group.errorType,
                        color: 'bg-slate-100 text-slate-700 border-slate-200',
                      };
                      const totalErrors = logs.length || 1;
                      const percentage = Math.min(100, Math.round((group.count / totalErrors) * 100));

                      return (
                        <tr
                          key={`${group.errorType}-${group.sourceTable}-${idx}`}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Error Type */}
                          <td className="py-3.5 px-4">
                            <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border inline-block ${meta.color}`}>
                              {meta.labelAr}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 block mt-1" dir="ltr">
                              [{group.errorType}]
                            </span>
                          </td>

                          {/* Source Table */}
                          <td className="py-3.5 px-4">
                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-lg font-mono text-xs font-bold border border-slate-200 dark:border-slate-700">
                              <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                              <span>{group.sourceTable}</span>
                            </div>
                            {group.sampleCode && (
                              <span className="text-[10px] font-mono text-slate-400 block mt-1" dir="ltr">
                                Code: {group.sampleCode}
                              </span>
                            )}
                          </td>

                          {/* Count & Frequency */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex flex-col items-center">
                              <span className="font-mono font-black text-sm text-slate-900 dark:text-white">
                                {group.count}
                              </span>
                              <div className="w-16 bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1">
                                <div
                                  className={`h-full ${group.count > 5 ? 'bg-rose-500' : 'bg-emerald-500'}`}
                                  style={{ width: `${Math.max(10, percentage)}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono mt-0.5">
                                {percentage}% من الإجمالي
                              </span>
                            </div>
                          </td>

                          {/* Unresolved Count */}
                          <td className="py-3.5 px-4 text-center">
                            {group.unresolvedCount > 0 ? (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800 inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-rose-600" />
                                <span>{group.unresolvedCount} معلق</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 inline-flex items-center gap-1">
                                <Check className="w-3 h-3 text-emerald-600" />
                                <span>معالج بالكامل</span>
                              </span>
                            )}
                          </td>

                          {/* Sample Message */}
                          <td className="py-3.5 px-4 max-w-xs font-mono text-[11px] text-slate-700 dark:text-slate-300">
                            <div className="truncate" title={group.sampleMessage}>
                              {group.sampleMessage}
                            </div>
                          </td>

                          {/* Last Occurred */}
                          <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {new Date(group.lastOccurredAt).toLocaleString('ar-YE')}
                          </td>

                          {/* Action Button */}
                          <td className="py-3.5 px-4 text-left">
                            <button
                              onClick={() => handleFilterByGroup(group.errorType, group.sourceTable)}
                              className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 font-bold rounded-xl transition-all border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 text-[11px] shadow-sm whitespace-nowrap"
                            >
                              <span>فلترة وعرض السجلات</span>
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: DETAILED SYSTEM ERROR LOG TABLE */}
      {viewMode === 'detailed' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Table className="w-4 h-4 text-blue-600" />
                <span>سجل الأخطاء التفصيلي الزمني (Detailed Error Logs)</span>
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                عرض كامل لجميع السجلات الفردية مع إمكانية التشخيص ومعاينة الحقول المشفرة
              </p>
            </div>
            {(selectedErrorType !== 'ALL' || selectedTable !== 'ALL') && (
              <button
                onClick={clearFilters}
                className="text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline flex items-center gap-1"
              >
                <span>إلغاء الفلترة السريعة</span>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 border-b border-slate-200 dark:border-slate-800 font-semibold">
                <tr>
                  <th className="py-3.5 px-4">التاريخ والوقت</th>
                  <th className="py-3.5 px-4">العملية</th>
                  <th className="py-3.5 px-4">المصدر / الجدول</th>
                  <th className="py-3.5 px-4">التصنيف</th>
                  <th className="py-3.5 px-4 font-mono">الرمز</th>
                  <th className="py-3.5 px-4">الرسالة الأصلية</th>
                  <th className="py-3.5 px-4">الحالة</th>
                  <th className="py-3.5 px-4 text-left">التفاصيل / الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-600" />
                      <span>جارِ تحميل سجل الأخطاء من Supabase...</span>
                    </td>
                  </tr>
                ) : logs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-slate-400 space-y-2">
                      <ShieldAlert className="w-8 h-8 text-emerald-500 mx-auto opacity-60" />
                      <div className="font-bold text-slate-700 dark:text-slate-300">لا توجد أخطاء مطابقة للفلاتر المححددة</div>
                      <div className="text-xs">قاعدة البيانات تعمل بسلاسة دون وجود استثناءات معلقة.</div>
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => {
                    const meta = ERROR_TYPE_LABELS[log.errorType] || { labelAr: log.errorType, color: 'bg-slate-100 text-slate-700' };
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(log.occurredAt).toLocaleString('ar-YE')}
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 dark:text-white">{log.operation}</div>
                          <div className="text-[10px] text-slate-400 font-mono">{log.sourceTable || log.sourceFunction || 'عام'}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border block w-fit ${meta.color}`}>
                            {meta.labelAr}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400 block mt-0.5" dir="ltr">
                            [{log.errorType}]
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono font-bold rounded text-[11px] border border-slate-200 dark:border-slate-700">
                            {log.errorCode || 'ERR'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-slate-800 dark:text-slate-200 max-w-sm font-mono text-[11px] truncate" title={`${log.errorType}: ${log.message}`}>
                          <span className="font-bold text-rose-600 dark:text-rose-400">{log.errorType}</span>: {log.message}
                        </td>
                        <td className="py-3.5 px-4">
                          {log.resolved ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              تم الحل
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                              جديد / معلق
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-left">
                          <button
                            onClick={() => {
                              setSelectedLog(log);
                              setResolutionNote(log.resolutionNote || '');
                            }}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg transition-colors flex items-center gap-1 text-[11px]"
                          >
                            <Eye className="w-3.5 h-3.5 text-emerald-600" />
                            <span>عرض وتشخيص</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Safe Error Detail Modal / Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full p-6 space-y-5 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="px-2.5 py-0.5 rounded font-mono text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    ID: {selectedLog.id.slice(0, 12)}
                  </span>
                  <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800">
                    {selectedLog.environment}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span>تشخيص الخطأ: {selectedLog.operation}</span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Meta Cards */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3.5 rounded-2xl bg-rose-50/60 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
                <span className="text-slate-500 dark:text-slate-400 block mb-1 font-bold">نوع وتصنيف الخطأ (Error Type):</span>
                <span className="font-extrabold text-sm text-rose-700 dark:text-rose-300 block">
                  {ERROR_TYPE_LABELS[selectedLog.errorType]?.labelAr || selectedLog.errorType}
                </span>
                <span className="font-mono text-[10px] text-slate-400 block mt-0.5" dir="ltr">
                  [{selectedLog.errorType}]
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block mb-1 font-bold">رمز واسم الخطأ الأصلي (Code & Name):</span>
                <span className="font-mono font-black text-sm text-slate-900 dark:text-white block">
                  {selectedLog.errorCode || 'ERR_UNCLASSIFIED'}
                </span>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  مستوى الخطورة: <strong className="text-rose-600 dark:text-rose-400">{selectedLog.severity || 'MEDIUM'}</strong>
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block mb-1 font-bold">العملية والجدول المصدر:</span>
                <span className="font-bold text-slate-900 dark:text-white block">
                  {selectedLog.operation}
                </span>
                <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                  جدول/دالة: {selectedLog.sourceTable || selectedLog.sourceFunction || 'عام'}
                </span>
              </div>

              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 dark:text-slate-400 block mb-1 font-bold">تاريخ ووقت الحدوث:</span>
                <span className="font-mono text-slate-800 dark:text-slate-200 block text-xs">
                  {new Date(selectedLog.occurredAt).toLocaleString('ar-YE')}
                </span>
                <span className="font-mono text-[10px] text-slate-400 block mt-0.5">
                  مسار API: {selectedLog.apiRoute || '---'}
                </span>
              </div>
            </div>

            {/* Original Error Message */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-800 dark:text-slate-200 block">نص ورسالة الخطأ الخام الأصلي (Original Raw Error Message):</label>
              <div className="p-4 rounded-2xl bg-slate-900 text-rose-400 border border-slate-800 font-mono text-xs leading-relaxed break-words shadow-inner">
                {selectedLog.message}
              </div>
            </div>

            {/* Sanitized JSON Details */}
            {selectedLog.details && Object.keys(selectedLog.details).length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">تفاصيل عملية التشخيص المفلترة (Sanitized Details):</label>
                <pre className="p-3.5 rounded-xl bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto border border-slate-800">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            )}

            {/* Resolution Form */}
            <form onSubmit={handleResolveLog} className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                ملاحظة المعالجة الإدارية (Resolution Note):
              </label>
              <textarea
                rows={2}
                placeholder="اكتب إجراء الحل أو ملاحظتك الإدارية هنا..."
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                className="w-full p-3 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500"
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="px-4 py-2 text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                >
                  إغلاق
                </button>
                <button
                  type="submit"
                  disabled={isResolving}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Check className="w-4 h-4" />
                  <span>{isResolving ? 'جاري الحفظ...' : 'تحديد كـ تم الحل والمعالجة'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
