import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _sessionsProvider = FutureProvider.autoDispose<List<UserSession>>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return [];
  return ref.watch(accountRepositoryProvider).activeSessions(userId);
});

class SessionsScreen extends ConsumerWidget {
  const SessionsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_sessionsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Active sessions')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) =>
            ErrorView(message: '$e', onRetry: () => ref.invalidate(_sessionsProvider)),
        data: (list) => list.isEmpty
            ? const EmptyView(icon: Icons.devices, title: 'No active sessions')
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final s = list[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      leading: const Icon(Icons.devices_outlined),
                      title: Text(s.device ?? 'Unknown device'),
                      subtitle: Text(
                          '${s.location ?? 'Unknown'} · ${formatRelative(s.lastSeenAt)}'),
                      trailing: TextButton(
                        onPressed: () async {
                          await ref
                              .read(accountRepositoryProvider)
                              .revokeSession(s.id);
                          ref.invalidate(_sessionsProvider);
                        },
                        child: const Text('Revoke'),
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
