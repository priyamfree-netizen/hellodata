import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';
import '../features/dashboard/data/dashboard_repository.dart';
import '../features/documents/data/document_repository.dart';
import '../features/notifications/data/notification_repository.dart';
import '../features/organization/data/org_repository.dart';
import '../features/output/data/extraction_repository.dart';
import '../features/processing/data/job_repository.dart';
import '../features/settings/data/account_repository.dart';
import '../features/settings/data/billing_repository.dart';
import '../features/support/data/support_repository.dart';
import '../features/templates/data/template_repository.dart';

/// The organization the app is currently acting within.
final activeOrgIdProvider = Provider<String?>((ref) {
  return ref.watch(sessionControllerProvider).activeOrgId;
});

/// The signed-in user id.
final currentUserIdProvider = Provider<String?>((ref) {
  return ref.watch(sessionControllerProvider).userId;
});

final orgRepositoryProvider = Provider<OrgRepository>(
    (ref) => OrgRepository(ref.watch(supabaseDataClientProvider)));

final documentRepositoryProvider = Provider<DocumentRepository>((ref) =>
    DocumentRepository(
        ref.watch(supabaseDataClientProvider), ref.watch(apiClientProvider)));

final templateRepositoryProvider = Provider<TemplateRepository>(
    (ref) => TemplateRepository(ref.watch(supabaseDataClientProvider)));

final jobRepositoryProvider = Provider<JobRepository>(
    (ref) => JobRepository(ref.watch(supabaseDataClientProvider)));

final extractionRepositoryProvider = Provider<ExtractionRepository>((ref) =>
    ExtractionRepository(
        ref.watch(supabaseDataClientProvider), ref.watch(apiClientProvider)));

final dashboardRepositoryProvider = Provider<DashboardRepository>(
    (ref) => DashboardRepository(ref.watch(supabaseDataClientProvider)));

final accountRepositoryProvider = Provider<AccountRepository>((ref) =>
    AccountRepository(
        ref.watch(supabaseDataClientProvider), ref.watch(apiClientProvider)));

final billingRepositoryProvider = Provider<BillingRepository>(
    (ref) => BillingRepository(ref.watch(supabaseDataClientProvider)));

final notificationRepositoryProvider = Provider<NotificationRepository>(
    (ref) => NotificationRepository(ref.watch(supabaseDataClientProvider)));

final supportRepositoryProvider = Provider<SupportRepository>(
    (ref) => SupportRepository(ref.watch(supabaseDataClientProvider)));
