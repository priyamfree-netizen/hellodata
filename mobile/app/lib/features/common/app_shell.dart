import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/repositories.dart';
import '../../core/theme/app_theme.dart';

/// Bottom-nav shell used by all workspace-ready screens. A center Scan FAB is
/// the primary action (capture-first mobile identity).
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.navigationShell});
  final StatefulNavigationShell navigationShell;

  static const _tabs = [
    (icon: Icons.dashboard_outlined, active: Icons.dashboard, label: 'Home'),
    (icon: Icons.history_outlined, active: Icons.history, label: 'History'),
    (icon: Icons.grid_view_outlined, active: Icons.grid_view, label: 'Templates'),
    (icon: Icons.settings_outlined, active: Icons.settings, label: 'Settings'),
  ];

  void _goBranch(int index) {
    navigationShell.goBranch(index, initialLocation: index == navigationShell.currentIndex);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    final current = navigationShell.currentIndex;

    return Scaffold(
      body: navigationShell,
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      floatingActionButton: FloatingActionButton(
        backgroundColor: colors.brandBlue,
        foregroundColor: Colors.white,
        elevation: 2,
        onPressed: () => context.push('/scan'),
        child: const Icon(Icons.document_scanner_outlined),
      ),
      bottomNavigationBar: BottomAppBar(
        color: colors.sidebar,
        height: 64,
        padding: EdgeInsets.zero,
        shape: const CircularNotchedRectangle(),
        notchMargin: 8,
        child: Row(
          children: [
            _navItem(context, 0, current),
            _navItem(context, 1, current),
            const Expanded(child: SizedBox()), // notch gap
            _navItem(context, 2, current),
            _navItem(context, 3, current),
          ],
        ),
      ),
    );
  }

  Widget _navItem(BuildContext context, int index, int current) {
    final colors = context.colors;
    final tab = _tabs[index];
    final selected = index == current;
    return Expanded(
      child: InkWell(
        onTap: () => _goBranch(index),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              selected ? tab.active : tab.icon,
              size: 22,
              color: selected ? colors.brandBlue : colors.mutedForeground,
            ),
            const SizedBox(height: 2),
            Text(
              tab.label,
              style: TextStyle(
                fontSize: 11,
                color: selected ? colors.brandBlue : colors.mutedForeground,
                fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A small bell action with unread badge for app bars.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final userId = ref.watch(currentUserIdProvider);
    final unread = userId == null
        ? const AsyncValue.data(0)
        : ref.watch(_unreadCountProvider(userId));
    final count = unread.value ?? 0;
    return Stack(
      alignment: Alignment.center,
      children: [
        IconButton(
          icon: const Icon(Icons.notifications_none_rounded),
          onPressed: () => context.push('/notifications'),
        ),
        if (count > 0)
          Positioned(
            top: 10,
            right: 10,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: context.colors.destructive,
                shape: BoxShape.circle,
              ),
              constraints: const BoxConstraints(minWidth: 8, minHeight: 8),
            ),
          ),
      ],
    );
  }
}

final _unreadCountProvider = FutureProvider.family<int, String>((ref, userId) async {
  return ref.watch(notificationRepositoryProvider).unreadCount(userId);
});
