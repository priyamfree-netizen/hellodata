// RadioListTile groupValue/onChanged are deprecated in favor of RadioGroup;
// the classic API is retained here until we migrate the selection widgets.
// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _orgProvider = FutureProvider.autoDispose<Organization?>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return null;
  return ref.watch(orgRepositoryProvider).byId(orgId);
});

final _membersProvider =
    FutureProvider.autoDispose<List<OrganizationMember>>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return [];
  return ref.watch(orgRepositoryProvider).members(orgId);
});

final _myOrgsProvider = FutureProvider.autoDispose<List<Organization>>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return [];
  return ref.watch(orgRepositoryProvider).myOrganizations(userId);
});

class OrganizationScreen extends ConsumerWidget {
  const OrganizationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final org = ref.watch(_orgProvider);
    final members = ref.watch(_membersProvider);
    final myOrgs = ref.watch(_myOrgsProvider);
    final activeOrgId = ref.watch(activeOrgIdProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('Organization')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          org.when(
            loading: () => const LoadingView(),
            error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.invalidate(_orgProvider)),
            data: (o) => o == null
                ? const SizedBox.shrink()
                : Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(o.name,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text('@${o.slug}',
                              style: TextStyle(color: colors.mutedForeground)),
                          const SizedBox(height: 12),
                          _kv('Team size', '${o.teamSize}'),
                          _kv('Storage used',
                              '${formatBytes(o.storageUsedBytes)} / ${formatBytes(o.storageLimitBytes)}'),
                          _kv('Pages processed', '${o.pagesProcessed}'),
                        ],
                      ),
                    ),
                  ),
          ),
          const SizedBox(height: 20),
          _workspaceSwitcher(context, ref, myOrgs, activeOrgId),
          const SizedBox(height: 20),
          Text('Members', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          members.when(
            loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24), child: LoadingView()),
            error: (e, _) =>
                ErrorView(message: '$e', onRetry: () => ref.invalidate(_membersProvider)),
            data: (list) => Column(
              children: [
                for (final m in list)
                  Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: CircleAvatar(
                        backgroundColor: colors.surface2,
                        child: Text(m.profile?.initials ?? '?',
                            style: const TextStyle(fontSize: 14)),
                      ),
                      title: Text(m.profile?.displayName ?? m.profile?.email ?? 'Member'),
                      subtitle: Text(m.profile?.email ?? ''),
                      trailing: Text(titleCase(m.role),
                          style: TextStyle(color: colors.mutedForeground)),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _workspaceSwitcher(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<Organization>> myOrgs,
    String? activeOrgId,
  ) {
    return myOrgs.maybeWhen(
      data: (orgs) {
        if (orgs.length < 2) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Switch workspace', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final o in orgs)
              RadioListTile<String>(
                value: o.id,
                groupValue: activeOrgId,
                onChanged: (v) {
                  if (v != null) {
                    ref.read(sessionControllerProvider.notifier).setActiveOrg(v);
                    ref.invalidate(_orgProvider);
                    ref.invalidate(_membersProvider);
                  }
                },
                title: Text(o.name),
                contentPadding: EdgeInsets.zero,
              ),
          ],
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }

  Widget _kv(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [Text(k), Text(v, style: const TextStyle(fontWeight: FontWeight.w600))],
        ),
      );
}
