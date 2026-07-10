import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_chip.dart';

final _ticketsProvider = FutureProvider.autoDispose<List<Ticket>>((ref) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return [];
  return ref.watch(supportRepositoryProvider).myTickets(userId);
});

class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_ticketsProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Support')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _newTicket(context, ref),
        icon: const Icon(Icons.add),
        label: const Text('New ticket'),
      ),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) =>
            ErrorView(message: '$e', onRetry: () => ref.invalidate(_ticketsProvider)),
        data: (list) => list.isEmpty
            ? const EmptyView(
                icon: Icons.support_agent_outlined,
                title: 'No tickets',
                subtitle: 'Create a ticket if you need help.')
            : ListView.builder(
                padding: const EdgeInsets.all(16),
                itemCount: list.length,
                itemBuilder: (context, i) {
                  final t = list[i];
                  return Card(
                    margin: const EdgeInsets.only(bottom: 8),
                    child: ListTile(
                      title: Text(t.subject),
                      subtitle: Text(formatRelative(t.createdAt)),
                      trailing: StatusChip(t.status),
                    ),
                  );
                },
              ),
      ),
    );
  }

  Future<void> _newTicket(BuildContext context, WidgetRef ref) async {
    final subjectCtrl = TextEditingController();
    final bodyCtrl = TextEditingController();
    final created = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 20,
          right: 20,
          top: 20,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('New ticket', style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 16),
            TextField(
                controller: subjectCtrl,
                decoration: const InputDecoration(labelText: 'Subject')),
            const SizedBox(height: 12),
            TextField(
              controller: bodyCtrl,
              maxLines: 4,
              decoration: const InputDecoration(labelText: 'How can we help?'),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Submit'),
              ),
            ),
          ],
        ),
      ),
    );

    if (created == true && subjectCtrl.text.trim().isNotEmpty) {
      final userId = ref.read(currentUserIdProvider);
      final orgId = ref.read(activeOrgIdProvider);
      if (userId == null) return;
      try {
        await ref.read(supportRepositoryProvider).createTicket(
              userId: userId,
              orgId: orgId,
              subject: subjectCtrl.text.trim(),
              body: bodyCtrl.text.trim(),
            );
        ref.invalidate(_ticketsProvider);
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('Ticket created')));
        }
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(SnackBar(content: Text('Failed: $e')));
        }
      }
    }
  }
}
