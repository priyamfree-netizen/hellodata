import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _catProvider = FutureProvider.autoDispose<List<DocumentCategory>>(
    (ref) => ref.watch(templateRepositoryProvider).categories());

final _tmplProvider = FutureProvider.autoDispose
    .family<List<Template>, String?>((ref, catId) =>
        ref.watch(templateRepositoryProvider).templates(categoryId: catId));

class TemplatesScreen extends ConsumerStatefulWidget {
  const TemplatesScreen({super.key});

  @override
  ConsumerState<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends ConsumerState<TemplatesScreen> {
  String? _catId;

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(_catProvider);
    final tmpls = ref.watch(_tmplProvider(_catId));

    return Scaffold(
      appBar: AppBar(title: const Text('Templates')),
      body: Column(
        children: [
          cats.maybeWhen(
            data: (list) => SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                children: [
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: const Text('All'),
                      selected: _catId == null,
                      onSelected: (_) => setState(() => _catId = null),
                    ),
                  ),
                  for (final c in list)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: ChoiceChip(
                        label: Text(c.name),
                        selected: _catId == c.id,
                        onSelected: (_) => setState(() => _catId = c.id),
                      ),
                    ),
                ],
              ),
            ),
            orElse: () => const SizedBox(height: 48),
          ),
          Expanded(
            child: tmpls.when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(
                  message: '$e', onRetry: () => ref.invalidate(_tmplProvider(_catId))),
              data: (list) => list.isEmpty
                  ? const EmptyView(
                      icon: Icons.grid_view_outlined,
                      title: 'No templates',
                      subtitle: 'Templates are managed on the web app.')
                  : ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 96),
                      itemCount: list.length,
                      itemBuilder: (context, i) =>
                          _TemplateCard(template: list[i]),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TemplateCard extends StatelessWidget {
  const _TemplateCard({required this.template});
  final Template template;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: colors.brandBlue.withValues(alpha: 0.12),
          child: Icon(Icons.grid_view, size: 20, color: colors.brandBlue),
        ),
        title: Row(
          children: [
            Flexible(child: Text(template.name, overflow: TextOverflow.ellipsis)),
            if (template.isFeatured) ...[
              const SizedBox(width: 6),
              Icon(Icons.star, size: 14, color: colors.brandLime),
            ],
          ],
        ),
        subtitle: Text(
            '${template.fieldCount} fields${template.isPublic ? ' · public' : ''}'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.push('/template/${template.id}'),
      ),
    );
  }
}
