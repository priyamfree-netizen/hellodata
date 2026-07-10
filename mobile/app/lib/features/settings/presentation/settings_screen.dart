import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/providers.dart';
import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';

final profileProvider = FutureProvider.autoDispose<Profile?>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return null;
  return ref.watch(accountRepositoryProvider).profile(userId);
});

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(profileProvider);
    final session = ref.watch(sessionControllerProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(0, 8, 0, 96),
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 28,
                  backgroundColor: colors.brandBlue.withValues(alpha: 0.15),
                  child: Text(
                    profile.value?.initials ?? '?',
                    style: TextStyle(
                        color: colors.brandBlue, fontWeight: FontWeight.w700, fontSize: 18),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(profile.value?.displayName ?? session.email ?? '',
                          style: Theme.of(context).textTheme.titleMedium),
                      Text(session.email ?? '',
                          style: TextStyle(color: colors.mutedForeground)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          _section(context, 'Account'),
          _tile(context, Icons.person_outline, 'Profile', () => context.push('/settings/profile')),
          _tile(context, Icons.lock_outline, 'Password & security',
              () => context.push('/settings/security')),
          _tile(context, Icons.devices_outlined, 'Active sessions',
              () => context.push('/settings/sessions')),
          _section(context, 'Workspace'),
          _tile(context, Icons.business_outlined, 'Organization',
              () => context.push('/settings/organization')),
          _tile(context, Icons.credit_card_outlined, 'Billing & plan',
              () => context.push('/settings/billing')),
          _section(context, 'Support'),
          _tile(context, Icons.support_agent_outlined, 'Help & tickets',
              () => context.push('/support')),
          _tile(context, Icons.notifications_none, 'Notifications',
              () => context.push('/notifications')),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton.icon(
              onPressed: () => ref.read(sessionControllerProvider.notifier).logout(),
              icon: Icon(Icons.logout, color: colors.destructive),
              label: Text('Sign out', style: TextStyle(color: colors.destructive)),
              style: OutlinedButton.styleFrom(
                  side: BorderSide(color: colors.destructive.withValues(alpha: 0.4))),
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String label) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
        child: Text(label.toUpperCase(),
            style: TextStyle(
                color: context.colors.mutedForeground,
                fontSize: 12,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5)),
      );

  Widget _tile(BuildContext context, IconData icon, String label, VoidCallback onTap) =>
      ListTile(
        leading: Icon(icon),
        title: Text(label),
        trailing: const Icon(Icons.chevron_right, size: 20),
        onTap: onTap,
      );
}
