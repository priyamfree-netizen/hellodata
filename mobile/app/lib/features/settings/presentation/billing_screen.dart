import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_chip.dart';
import 'settings_screen.dart';

final _subscriptionProvider = FutureProvider.autoDispose<Subscription?>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return null;
  return ref.watch(billingRepositoryProvider).activeSubscription(orgId);
});

final _invoicesProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return [];
  return ref.watch(billingRepositoryProvider).invoices(orgId);
});

class BillingScreen extends ConsumerWidget {
  const BillingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sub = ref.watch(_subscriptionProvider);
    final invoices = ref.watch(_invoicesProvider);
    final profile = ref.watch(profileProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('Billing & plan')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Current plan',
                      style: TextStyle(color: colors.mutedForeground, fontSize: 13)),
                  const SizedBox(height: 6),
                  sub.when(
                    loading: () => const SizedBox(
                        height: 24,
                        child: Align(
                            alignment: Alignment.centerLeft,
                            child: SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(strokeWidth: 2)))),
                    error: (e, _) => Text('$e', style: TextStyle(color: colors.destructive)),
                    data: (s) => Text(
                      s?.plan?.name ?? 'Free plan',
                      style: Theme.of(context)
                          .textTheme
                          .headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Icon(Icons.toll_outlined, size: 18, color: colors.mutedForeground),
                      const SizedBox(width: 6),
                      Text(
                          '${profile.value?.creditsRemaining ?? 0} credits remaining'),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Text('Invoices', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          invoices.when(
            loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24), child: LoadingView()),
            error: (e, _) => ErrorView(
                message: '$e', onRetry: () => ref.invalidate(_invoicesProvider)),
            data: (list) => list.isEmpty
                ? const EmptyView(
                    icon: Icons.receipt_long_outlined, title: 'No invoices yet')
                : Column(
                    children: [
                      for (final inv in list)
                        Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          child: ListTile(
                            title: Text('${inv['number'] ?? 'Invoice'}'),
                            subtitle: Text(formatDate(
                                DateTime.tryParse('${inv['issue_date']}'))),
                            trailing: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.end,
                              children: [
                                Text(formatInr(
                                    double.tryParse('${inv['amount_inr']}'))),
                                const SizedBox(height: 2),
                                StatusChip('${inv['status'] ?? 'open'}'),
                              ],
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          const SizedBox(height: 16),
          Text('Plan changes and payments are managed on the web app.',
              style: TextStyle(color: colors.mutedForeground, fontSize: 13),
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
