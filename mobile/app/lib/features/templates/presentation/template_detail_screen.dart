import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _detailProvider = FutureProvider.autoDispose
    .family<(Template?, List<TemplateField>), String>((ref, id) async {
  final repo = ref.watch(templateRepositoryProvider);
  final template = await repo.byId(id);
  final fields = await repo.fields(id);
  return (template, fields);
});

class TemplateDetailScreen extends ConsumerWidget {
  const TemplateDetailScreen({super.key, required this.templateId});
  final String templateId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(_detailProvider(templateId));
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('Template')),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
            message: '$e', onRetry: () => ref.invalidate(_detailProvider(templateId))),
        data: (record) {
          final (template, fields) = record;
          if (template == null) {
            return const EmptyView(icon: Icons.search_off, title: 'Template not found');
          }
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(template.name, style: Theme.of(context).textTheme.headlineSmall),
              if (template.description != null) ...[
                const SizedBox(height: 8),
                Text(template.description!,
                    style: TextStyle(color: colors.mutedForeground)),
              ],
              const SizedBox(height: 12),
              Row(
                children: [
                  _Meta(icon: Icons.list_alt, label: '${fields.length} fields'),
                  const SizedBox(width: 16),
                  _Meta(icon: Icons.download, label: '${template.downloads}'),
                  if (template.rating > 0) ...[
                    const SizedBox(width: 16),
                    _Meta(
                        icon: Icons.star,
                        label: template.rating.toStringAsFixed(1)),
                  ],
                ],
              ),
              const Divider(height: 32),
              Text('Fields', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              for (final f in fields)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  leading: Icon(
                    f.isEnabled ? Icons.check_circle_outline : Icons.remove_circle_outline,
                    color: f.isEnabled ? colors.brandLime : colors.mutedForeground,
                    size: 20,
                  ),
                  title: Text(f.label),
                  subtitle: Text('${f.key} · ${f.dataType}'),
                  trailing: f.isRequired
                      ? Text('required',
                          style: TextStyle(color: colors.brandBlue, fontSize: 12))
                      : null,
                ),
            ],
          );
        },
      ),
    );
  }
}

class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.label});
  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: colors.mutedForeground),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(color: colors.mutedForeground)),
      ],
    );
  }
}
