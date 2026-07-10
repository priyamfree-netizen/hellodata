import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/session_status.dart';
import '../providers.dart';
import '../../features/auth/presentation/login_screen.dart';
import '../../features/auth/presentation/signup_screen.dart';
import '../../features/auth/presentation/forgot_password_screen.dart';
import '../../features/capture/presentation/scan_screen.dart';
import '../../features/configure/presentation/configure_screen.dart';
import '../../features/common/app_shell.dart';
import '../../features/common/backend_error_screen.dart';
import '../../features/common/splash_screen.dart';
import '../../features/dashboard/presentation/home_screen.dart';
import '../../features/history/presentation/history_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import '../../features/onboarding/presentation/create_workspace_screen.dart';
import '../../features/output/presentation/output_screen.dart';
import '../../features/processing/presentation/processing_screen.dart';
import '../../features/settings/presentation/billing_screen.dart';
import '../../features/settings/presentation/organization_screen.dart';
import '../../features/settings/presentation/profile_screen.dart';
import '../../features/settings/presentation/security_screen.dart';
import '../../features/settings/presentation/sessions_screen.dart';
import '../../features/settings/presentation/settings_screen.dart';
import '../../features/support/presentation/support_screen.dart';
import '../../features/templates/presentation/template_detail_screen.dart';
import '../../features/templates/presentation/templates_screen.dart';

/// Bridges Riverpod state changes into a [Listenable] so GoRouter re-evaluates
/// redirects whenever the session status changes.
class _RouterRefresh extends ChangeNotifier {
  _RouterRefresh(Ref ref) {
    ref.listen(sessionControllerProvider, (_, _) => notifyListeners());
  }
}

final _rootKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh(ref);

  return GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/splash',
    refreshListenable: refresh,
    redirect: (context, state) {
      final status = ref.read(sessionControllerProvider).status;
      final loc = state.matchedLocation;

      switch (status) {
        case SessionStatus.loading:
          return loc == '/splash' ? null : '/splash';
        case SessionStatus.backendError:
          return loc == '/error' ? null : '/error';
        case SessionStatus.unauthenticated:
          const authRoutes = {'/login', '/signup', '/forgot'};
          return authRoutes.contains(loc) ? null : '/login';
        case SessionStatus.noWorkspace:
          return loc == '/onboarding' ? null : '/onboarding';
        case SessionStatus.ready:
          const gateRoutes = {'/login', '/signup', '/forgot', '/splash', '/onboarding', '/error'};
          return gateRoutes.contains(loc) ? '/home' : null;
      }
    },
    routes: [
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/error', builder: (_, _) => const BackendErrorScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, _) => const SignupScreen()),
      GoRoute(path: '/forgot', builder: (_, _) => const ForgotPasswordScreen()),
      GoRoute(path: '/onboarding', builder: (_, _) => const CreateWorkspaceScreen()),

      // Pushed detail routes (over the shell).
      GoRoute(path: '/scan', builder: (_, _) => const ScanScreen()),
      GoRoute(
        path: '/configure/:documentId',
        builder: (_, s) =>
            ConfigureScreen(documentId: s.pathParameters['documentId']!),
      ),
      GoRoute(
        path: '/processing/:jobId',
        builder: (_, s) => ProcessingScreen(jobId: s.pathParameters['jobId']!),
      ),
      GoRoute(
        path: '/output/:extractionId',
        builder: (_, s) =>
            OutputScreen(extractionId: s.pathParameters['extractionId']!),
      ),
      GoRoute(path: '/notifications', builder: (_, _) => const NotificationsScreen()),
      GoRoute(path: '/support', builder: (_, _) => const SupportScreen()),
      GoRoute(
        path: '/template/:id',
        builder: (_, s) => TemplateDetailScreen(templateId: s.pathParameters['id']!),
      ),
      GoRoute(path: '/settings/profile', builder: (_, _) => const ProfileScreen()),
      GoRoute(path: '/settings/security', builder: (_, _) => const SecurityScreen()),
      GoRoute(path: '/settings/sessions', builder: (_, _) => const SessionsScreen()),
      GoRoute(path: '/settings/billing', builder: (_, _) => const BillingScreen()),
      GoRoute(
          path: '/settings/organization', builder: (_, _) => const OrganizationScreen()),

      // Bottom-nav shell.
      StatefulShellRoute.indexedStack(
        builder: (_, _, shell) => AppShell(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [
            GoRoute(path: '/home', builder: (_, _) => const HomeScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/history', builder: (_, _) => const HistoryScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/templates', builder: (_, _) => const TemplatesScreen()),
          ]),
          StatefulShellBranch(routes: [
            GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
          ]),
        ],
      ),
    ],
  );
});
