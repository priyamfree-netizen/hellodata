import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/models/models.dart';
import '../../../shared/widgets/state_views.dart';

/// Live job stream (Realtime) with an initial fetch. Used to watch an in-flight
/// job's stage progression.
final _jobStreamProvider =
    StreamProvider.autoDispose.family<ProcessingJob, String>((ref, jobId) {
  final repo = ref.watch(jobRepositoryProvider);
  return repo.watch(jobId);
});

final _jobInitialProvider =
    FutureProvider.autoDispose.family<ProcessingJob?, String>((ref, jobId) {
  return ref.watch(jobRepositoryProvider).byId(jobId);
});

const _stages = [
  ('queued', 'Queued'),
  ('ocr', 'OCR'),
  ('ai_extraction', 'AI extraction'),
  ('validation', 'Validation'),
  ('completed', 'Completed'),
];

class ProcessingScreen extends ConsumerWidget {
  const ProcessingScreen({super.key, required this.jobId});
  final String jobId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initial = ref.watch(_jobInitialProvider(jobId));
    final live = ref.watch(_jobStreamProvider(jobId));
    final job = live.value ?? initial.value;

    return Scaffold(
      appBar: AppBar(title: const Text('Processing')),
      body: initial.isLoading && job == null
          ? const LoadingView()
          : job == null
              ? ErrorView(
                  message: 'Job not found',
                  onRetry: () => ref.invalidate(_jobInitialProvider(jobId)))
              : _JobView(job: job),
    );
  }
}

class _JobView extends ConsumerWidget {
  const _JobView({required this.job});
  final ProcessingJob job;

  int get _currentStageIndex {
    final idx = _stages.indexWhere((s) => s.$1 == job.stage);
    if (job.stage == 'completed') return _stages.length - 1;
    return idx < 0 ? 0 : idx;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = context.colors;
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(job.name.isEmpty ? 'Document' : job.name,
            style: Theme.of(context).textTheme.titleLarge),
        const SizedBox(height: 4),
        Text('Job ${job.id.substring(0, 8)}',
            style: TextStyle(color: colors.mutedForeground)),
        const SizedBox(height: 24),
        if (job.isFailed)
          _FailedView(job: job)
        else
          for (int i = 0; i < _stages.length; i++)
            _StageRow(
              label: _stages[i].$2,
              done: i < _currentStageIndex || job.stage == 'completed',
              active: i == _currentStageIndex && job.stage != 'completed',
            ),
        const SizedBox(height: 24),
        if (job.stage == 'completed')
          ElevatedButton.icon(
            onPressed: () async {
              final ext = await ref
                  .read(extractionRepositoryProvider)
                  .byJobId(job.id);
              if (context.mounted && ext != null) {
                context.pushReplacement('/output/${ext.id}');
              }
            },
            icon: const Icon(Icons.check_circle_outline),
            label: const Text('View results'),
          ),
      ],
    );
  }
}

class _StageRow extends StatelessWidget {
  const _StageRow({required this.label, required this.done, required this.active});
  final String label;
  final bool done;
  final bool active;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final color = done
        ? colors.brandLime
        : active
            ? colors.brandBlue
            : colors.mutedForeground;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          SizedBox(
            width: 24,
            height: 24,
            child: active
                ? const CircularProgressIndicator(strokeWidth: 2.4)
                : Icon(
                    done ? Icons.check_circle : Icons.circle_outlined,
                    color: color,
                    size: 24,
                  ),
          ),
          const SizedBox(width: 14),
          Text(label,
              style: TextStyle(
                color: (done || active) ? colors.foreground : colors.mutedForeground,
                fontWeight: active ? FontWeight.w600 : FontWeight.w400,
              )),
        ],
      ),
    );
  }
}

class _FailedView extends StatelessWidget {
  const _FailedView({required this.job});
  final ProcessingJob job;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.destructive.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: colors.destructive),
          const SizedBox(width: 12),
          Expanded(
            child: Text(job.errorMessage ?? 'Extraction failed',
                style: TextStyle(color: colors.destructive)),
          ),
        ],
      ),
    );
  }
}
