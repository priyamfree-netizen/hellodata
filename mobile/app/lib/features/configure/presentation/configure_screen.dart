// RadioListTile groupValue/onChanged are deprecated in favor of RadioGroup;
// the classic API is retained here until we migrate the selection widgets.
// ignore_for_file: deprecated_member_use
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

final _categoriesProvider =
    FutureProvider.autoDispose<List<DocumentCategory>>((ref) async {
  return ref.watch(templateRepositoryProvider).categories();
});

final _templatesProvider = FutureProvider.autoDispose
    .family<List<Template>, String?>((ref, categoryId) async {
  return ref.watch(templateRepositoryProvider).templates(categoryId: categoryId);
});

final _fieldsProvider =
    FutureProvider.autoDispose.family<List<TemplateField>, String>((ref, tid) async {
  return ref.watch(templateRepositoryProvider).fields(tid, onlyEnabled: true);
});

/// Phase 5 — choose a category/template and start extraction. The Worker
/// `/api/extract/document` runs the pipeline synchronously, so on success we
/// route straight to the result. (In-flight jobs opened from History use the
/// realtime Processing screen.)
class ConfigureScreen extends ConsumerStatefulWidget {
  const ConfigureScreen({super.key, required this.documentId});
  final String documentId;

  @override
  ConsumerState<ConfigureScreen> createState() => _ConfigureScreenState();
}

class _ConfigureScreenState extends ConsumerState<ConfigureScreen> {
  String? _categoryId;
  Template? _template;
  bool _extracting = false;
  String? _error;

  Future<void> _extract() async {
    setState(() {
      _extracting = true;
      _error = null;
    });
    try {
      final res = await ref.read(extractionRepositoryProvider).extract(
            documentId: widget.documentId,
            templateId: _template?.id,
          );
      final extractionId = res['extraction_id']?.toString();
      if (!mounted) return;
      if (extractionId != null) {
        context.pushReplacement('/output/$extractionId');
      } else {
        setState(() => _error = 'Extraction did not return a result');
      }
    } catch (e) {
      setState(() => _error = 'Extraction failed: $e');
    } finally {
      if (mounted) setState(() => _extracting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final categories = ref.watch(_categoriesProvider);
    final templates = ref.watch(_templatesProvider(_categoryId));

    if (_extracting) {
      return Scaffold(
        appBar: AppBar(title: const Text('Extracting')),
        body: const LoadingView(label: 'Running OCR + AI extraction…\nThis can take a moment.'),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Configure extraction')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!, style: TextStyle(color: colors.destructive)),
            ),
          Text('Category', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          categories.when(
            loading: () => const LinearProgressIndicator(),
            error: (e, _) => Text('$e', style: TextStyle(color: colors.destructive)),
            data: (cats) => Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ChoiceChip(
                  label: const Text('All'),
                  selected: _categoryId == null,
                  onSelected: (_) => setState(() {
                    _categoryId = null;
                    _template = null;
                  }),
                ),
                for (final c in cats)
                  ChoiceChip(
                    label: Text(c.name),
                    selected: _categoryId == c.id,
                    onSelected: (_) => setState(() {
                      _categoryId = c.id;
                      _template = null;
                    }),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 20),
          Text('Template', style: Theme.of(context).textTheme.titleSmall),
          Text('Pick a template, or leave blank to use default fields.',
              style: TextStyle(color: colors.mutedForeground, fontSize: 13)),
          const SizedBox(height: 8),
          templates.when(
            loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24), child: LoadingView()),
            error: (e, _) => ErrorView(
                message: '$e',
                onRetry: () => ref.invalidate(_templatesProvider(_categoryId))),
            data: (list) => list.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: Text('No templates — default fields will be used.',
                        style: TextStyle(color: colors.mutedForeground)),
                  )
                : Column(
                    children: [
                      for (final t in list)
                        RadioListTile<String>(
                          value: t.id,
                          groupValue: _template?.id,
                          onChanged: (_) => setState(() => _template = t),
                          title: Text(t.name),
                          subtitle: Text('${t.fieldCount} fields'
                              '${t.isPublic ? ' · public' : ''}'),
                          contentPadding: EdgeInsets.zero,
                        ),
                    ],
                  ),
          ),
          if (_template != null) ...[
            const SizedBox(height: 8),
            _FieldPreview(templateId: _template!.id),
          ],
          const SizedBox(height: 24),
          ElevatedButton.icon(
            onPressed: _extract,
            icon: const Icon(Icons.auto_awesome),
            label: Text(_template == null ? 'Extract with default fields' : 'Extract'),
          ),
        ],
      ),
    );
  }
}

class _FieldPreview extends ConsumerWidget {
  const _FieldPreview({required this.templateId});
  final String templateId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fields = ref.watch(_fieldsProvider(templateId));
    return fields.maybeWhen(
      data: (list) => Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final f in list)
            Chip(
              label: Text(f.label, style: const TextStyle(fontSize: 12)),
              visualDensity: VisualDensity.compact,
            ),
        ],
      ),
      orElse: () => const SizedBox.shrink(),
    );
  }
}
