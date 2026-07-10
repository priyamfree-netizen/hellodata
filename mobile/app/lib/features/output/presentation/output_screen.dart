import 'package:csv/csv.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/utils/formatters.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';
import '../../../shared/widgets/status_chip.dart';

final _extractionProvider =
    FutureProvider.autoDispose.family<Extraction?, String>((ref, id) async {
  return ref.watch(extractionRepositoryProvider).byId(id);
});

/// Phase 7 — review extracted fields, edit values, export/share.
class OutputScreen extends ConsumerStatefulWidget {
  const OutputScreen({super.key, required this.extractionId});
  final String extractionId;

  @override
  ConsumerState<OutputScreen> createState() => _OutputScreenState();
}

class _OutputScreenState extends ConsumerState<OutputScreen> {
  final Map<String, TextEditingController> _controllers = {};
  bool _editing = false;
  bool _saving = false;

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, TextEditingController> _ensureControllers(Map<String, dynamic> data) {
    for (final entry in data.entries) {
      _controllers.putIfAbsent(
          entry.key, () => TextEditingController(text: '${entry.value ?? ''}'));
    }
    return _controllers;
  }

  Future<void> _save(Extraction ext) async {
    setState(() => _saving = true);
    try {
      final updated = <String, dynamic>{
        for (final e in _controllers.entries) e.key: e.value.text,
      };
      await ref
          .read(extractionRepositoryProvider)
          .updateData(ext.organizationId, ext.id, updated);
      ref.invalidate(_extractionProvider(ext.id));
      if (mounted) {
        setState(() => _editing = false);
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Saved')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('Save failed: $e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _toCsv(Map<String, dynamic> data) {
    final rows = <List<dynamic>>[
      ['Field', 'Value'],
      for (final e in data.entries) [e.key, '${e.value ?? ''}'],
    ];
    return csv.encode(rows);
  }

  Future<void> _share(Extraction ext) async {
    final csv = _toCsv(_currentData(ext));
    await SharePlus.instance.share(
      ShareParams(text: csv, subject: ext.document?.fileName ?? 'Extraction'),
    );
  }

  Map<String, dynamic> _currentData(Extraction ext) {
    if (_controllers.isEmpty) return ext.data;
    return {for (final e in _controllers.entries) e.key: e.value.text};
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(_extractionProvider(widget.extractionId));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Result'),
        actions: [
          async.maybeWhen(
            data: (ext) => ext == null
                ? const SizedBox.shrink()
                : Row(children: [
                    IconButton(
                      tooltip: 'Share as CSV',
                      icon: const Icon(Icons.ios_share),
                      onPressed: () => _share(ext),
                    ),
                    IconButton(
                      tooltip: _editing ? 'Cancel' : 'Edit',
                      icon: Icon(_editing ? Icons.close : Icons.edit_outlined),
                      onPressed: () => setState(() => _editing = !_editing),
                    ),
                  ]),
            orElse: () => const SizedBox.shrink(),
          ),
        ],
      ),
      body: async.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
            message: '$e', onRetry: () => ref.invalidate(_extractionProvider(widget.extractionId))),
        data: (ext) {
          if (ext == null) {
            return const EmptyView(
                icon: Icons.search_off, title: 'Result not found');
          }
          if (ext.status == 'failed') {
            return ErrorView(message: ext.errorMessage ?? 'Extraction failed');
          }
          final data = ext.data;
          _ensureControllers(data);
          return _ResultBody(
            ext: ext,
            editing: _editing,
            saving: _saving,
            controllers: _controllers,
            onSave: () => _save(ext),
            onCopy: () async {
              await Clipboard.setData(ClipboardData(text: _toCsv(_currentData(ext))));
              if (context.mounted) {
                ScaffoldMessenger.of(context)
                    .showSnackBar(const SnackBar(content: Text('Copied')));
              }
            },
          );
        },
      ),
    );
  }
}

class _ResultBody extends StatelessWidget {
  const _ResultBody({
    required this.ext,
    required this.editing,
    required this.saving,
    required this.controllers,
    required this.onSave,
    required this.onCopy,
  });
  final Extraction ext;
  final bool editing;
  final bool saving;
  final Map<String, TextEditingController> controllers;
  final VoidCallback onSave;
  final VoidCallback onCopy;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final data = ext.data;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(ext.document?.fileName ?? 'Extraction',
                  style: Theme.of(context).textTheme.titleMedium),
            ),
            StatusChip(ext.status),
          ],
        ),
        const SizedBox(height: 4),
        Row(
          children: [
            Text('${data.length} fields',
                style: TextStyle(color: colors.mutedForeground)),
            const SizedBox(width: 12),
            if (ext.confidence != null)
              Text('${ext.confidence!.toStringAsFixed(0)}% confidence',
                  style: TextStyle(color: colors.mutedForeground)),
            const Spacer(),
            Text(formatRelative(ext.createdAt),
                style: TextStyle(color: colors.mutedForeground)),
          ],
        ),
        const SizedBox(height: 16),
        if (data.isEmpty)
          const EmptyView(icon: Icons.inbox_outlined, title: 'No fields extracted')
        else
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Column(
                children: [
                  for (final entry in data.entries)
                    _FieldRow(
                      label: entry.key,
                      controller: controllers[entry.key]!,
                      editing: editing,
                    ),
                ],
              ),
            ),
          ),
        const SizedBox(height: 20),
        if (editing)
          ElevatedButton.icon(
            onPressed: saving ? null : onSave,
            icon: saving
                ? const SizedBox(
                    width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_outlined),
            label: const Text('Save changes'),
          )
        else
          OutlinedButton.icon(
            onPressed: onCopy,
            icon: const Icon(Icons.copy_all_outlined),
            label: const Text('Copy all'),
          ),
      ],
    );
  }
}

class _FieldRow extends StatelessWidget {
  const _FieldRow({
    required this.label,
    required this.controller,
    required this.editing,
  });
  final String label;
  final TextEditingController controller;
  final bool editing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(titleCase(label),
              style: TextStyle(
                  color: colors.mutedForeground,
                  fontSize: 12,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          if (editing)
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                isDense: true,
                contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
            )
          else
            Text(
              controller.text.isEmpty ? '—' : controller.text,
              style: const TextStyle(fontSize: 15),
            ),
          const Divider(height: 16),
        ],
      ),
    );
  }
}
