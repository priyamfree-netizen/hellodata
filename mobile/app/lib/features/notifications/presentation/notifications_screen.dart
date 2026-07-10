import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _notificationsProvider =
    FutureProvider.autoDispose<List<UserNotification>>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return [];
  return ref.watch(notificationRepositoryProvider).list(userId);
});

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_notificationsProvider);
    final userId = ref.watch(currentUserIdProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: () async {
              if (userId == null) return;
              await ref.read(notificationRepositoryProvider).markAllRead(userId);
              ref.invalidate(_notificationsProvider);
            },
            child: const Text('Mark all read'),
          ),
        ],
      ),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) =>
            ErrorView(message: '$e', onRetry: () => ref.invalidate(_notificationsProvider)),
        data: (list) => list.isEmpty
            ? const EmptyView(
                icon: Icons.notifications_none, title: 'No notifications')
            : RefreshIndicator(
                onRefresh: () async {
                  ref.invalidate(_notificationsProvider);
                  await ref.read(_notificationsProvider.future);
                },
                child: ListView.separated(
                  itemCount: list.length,
                  separatorBuilder: (_, _) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final n = list[i];
                    return ListTile(
                      leading: Icon(
                        n.isRead
                            ? Icons.notifications_none
                            : Icons.notifications_active,
                        color: n.isRead ? colors.mutedForeground : colors.brandBlue,
                      ),
                      title: Text(n.title,
                          style: TextStyle(
                              fontWeight:
                                  n.isRead ? FontWeight.w400 : FontWeight.w600)),
                      subtitle: n.body == null ? null : Text(n.body!),
                      trailing: Text(formatRelative(n.createdAt),
                          style: TextStyle(
                              color: colors.mutedForeground, fontSize: 12)),
                      onTap: () async {
                        if (!n.isRead) {
                          await ref
                              .read(notificationRepositoryProvider)
                              .markRead(n.id);
                          ref.invalidate(_notificationsProvider);
                        }
                      },
                    );
                  },
                ),
              ),
      ),
    );
  }
}
