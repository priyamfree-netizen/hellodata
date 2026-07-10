import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/brand_logo.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_chip.dart';
import '../../common/app_shell.dart';
import '../data/dashboard_repository.dart';

final _kpisProvider = FutureProvider.autoDispose<DashboardKpis>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  final userId = ref.watch(currentUserIdProvider);
  if (orgId == null) throw Exception('No workspace selected');
  final account = ref.watch(accountRepositoryProvider);
  final profile = userId == null ? null : await account.profile(userId);
  return ref
      .watch(dashboardRepositoryProvider)
      .load(orgId, profile?.creditsRemaining ?? 0);
});

final _recentExtractionsProvider =
    FutureProvider.autoDispose<List<Extraction>>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return [];
  return ref.watch(extractionRepositoryProvider).list(orgId, limit: 5);
});

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kpis = ref.watch(_kpisProvider);
    final recent = ref.watch(_recentExtractionsProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(
        title: const BrandLogo(fontSize: 22),
        actions: const [NotificationBell()],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(_kpisProvider);
          ref.invalidate(_recentExtractionsProvider);
          await ref.read(_kpisProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
          children: [
            kpis.when(
              loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 40), child: LoadingView()),
              error: (e, _) => ErrorView(
                  message: '$e', onRetry: () => ref.invalidate(_kpisProvider)),
              data: (k) => _KpiGrid(kpis: k),
            ),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Recent results',
                    style: Theme.of(context).textTheme.titleMedium),
                TextButton(
                    onPressed: () => context.go('/history'),
                    child: const Text('See all')),
              ],
            ),
            const SizedBox(height: 4),
            recent.when(
              loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32), child: LoadingView()),
              error: (e, _) => ErrorView(
                  message: '$e', onRetry: () => ref.invalidate(_recentExtractionsProvider)),
              data: (list) => list.isEmpty
                  ? EmptyView(
                      icon: Icons.document_scanner_outlined,
                      title: 'No documents yet',
                      subtitle: 'Tap Scan to capture your first document.',
                      actionLabel: 'Scan a document',
                      onAction: () => context.push('/scan'),
                    )
                  : Column(
                      children: [
                        for (final e in list)
                          _ExtractionTile(
                            extraction: e,
                            onTap: () => context.push('/output/${e.id}'),
                          ),
                      ],
                    ),
            ),
            const SizedBox(height: 16),
            Card(
              color: colors.brandBlue.withValues(alpha: 0.06),
              child: ListTile(
                leading: Icon(Icons.document_scanner_outlined, color: colors.brandBlue),
                title: const Text('Capture a document'),
                subtitle: const Text('Scan an invoice or bill and extract fields'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/scan'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _KpiGrid extends StatelessWidget {
  const _KpiGrid({required this.kpis});
  final DashboardKpis kpis;

  @override
  Widget build(BuildContext context) {
    final org = kpis.org;
    return Column(
      children: [
        Row(
          children: [
            _KpiCard(
                label: 'Documents',
                value: '${kpis.documents}',
                icon: Icons.description_outlined),
            const SizedBox(width: 12),
            _KpiCard(
                label: 'Extractions',
                value: '${kpis.extractions}',
                icon: Icons.auto_awesome_outlined),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            _KpiCard(
                label: 'Credits left',
                value: '${kpis.creditsRemaining}',
                icon: Icons.toll_outlined),
            const SizedBox(width: 12),
            _KpiCard(
              label: 'Storage',
              value: org == null
                  ? '—'
                  : formatBytes(org.storageUsedBytes),
              icon: Icons.cloud_outlined,
              progress: org?.storageFraction,
            ),
          ],
        ),
      ],
    );
  }
}

class _KpiCard extends StatelessWidget {
  const _KpiCard({
    required this.label,
    required this.value,
    required this.icon,
    this.progress,
  });
  final String label;
  final String value;
  final IconData icon;
  final double? progress;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Expanded(
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 20, color: colors.mutedForeground),
              const SizedBox(height: 12),
              Text(value,
                  style: Theme.of(context)
                      .textTheme
                      .headlineSmall
                      ?.copyWith(fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text(label, style: TextStyle(color: colors.mutedForeground, fontSize: 13)),
              if (progress != null) ...[
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: LinearProgressIndicator(
                    value: progress,
                    minHeight: 5,
                    backgroundColor: colors.surface2,
                    color: colors.brandBlue,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ExtractionTile extends StatelessWidget {
  const _ExtractionTile({required this.extraction, required this.onTap});
  final Extraction extraction;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final name = extraction.document?.fileName ?? 'Extraction';
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: colors.surface2,
          child: Icon(Icons.description_outlined, color: colors.mutedForeground, size: 20),
        ),
        title: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text(formatRelative(extraction.createdAt)),
        trailing: StatusChip(extraction.status),
        onTap: onTap,
      ),
    );
  }
}
