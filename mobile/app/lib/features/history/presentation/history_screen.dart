import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_chip.dart';

final _historyProvider =
    FutureProvider.autoDispose<List<Extraction>>((ref) async {
  final orgId = ref.watch(activeOrgIdProvider);
  if (orgId == null) return [];
  return ref.watch(extractionRepositoryProvider).list(orgId, limit: 100);
});

class HistoryScreen extends ConsumerStatefulWidget {
  const HistoryScreen({super.key});

  @override
  ConsumerState<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends ConsumerState<HistoryScreen> {
  String _query = '';
  String _statusFilter = 'all';

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(_historyProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('History')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search documents',
                isDense: true,
              ),
              onChanged: (v) => setState(() => _query = v.toLowerCase()),
            ),
          ),
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                for (final s in const ['all', 'done', 'processing', 'failed'])
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(titleCase(s)),
                      selected: _statusFilter == s,
                      onSelected: (_) => setState(() => _statusFilter = s),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: async.when(
              loading: () => const LoadingView(),
              error: (e, _) =>
                  ErrorView(message: '$e', onRetry: () => ref.invalidate(_historyProvider)),
              data: (list) {
                final filtered = list.where((e) {
                  final matchesStatus =
                      _statusFilter == 'all' || e.status == _statusFilter;
                  final matchesQuery = _query.isEmpty ||
                      (e.document?.fileName ?? '').toLowerCase().contains(_query);
                  return matchesStatus && matchesQuery;
                }).toList();

                if (filtered.isEmpty) {
                  return EmptyView(
                    icon: Icons.history,
                    title: list.isEmpty ? 'No history yet' : 'No matches',
                    subtitle: list.isEmpty
                        ? 'Extracted documents will appear here.'
                        : 'Try a different search or filter.',
                    actionLabel: list.isEmpty ? 'Scan a document' : null,
                    onAction: list.isEmpty ? () => context.push('/scan') : null,
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(_historyProvider);
                    await ref.read(_historyProvider.future);
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                    itemCount: filtered.length,
                    itemBuilder: (context, i) {
                      final e = filtered[i];
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: colors.surface2,
                            child: Icon(Icons.description_outlined,
                                size: 20, color: colors.mutedForeground),
                          ),
                          title: Text(e.document?.fileName ?? 'Extraction',
                              maxLines: 1, overflow: TextOverflow.ellipsis),
                          subtitle: Text(
                              '${e.fieldCount} fields · ${formatRelative(e.createdAt)}'),
                          trailing: StatusChip(e.status),
                          onTap: () => context.push('/output/${e.id}'),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
