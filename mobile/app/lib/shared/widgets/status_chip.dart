import 'package:flutter/material.dart';

import '../../core/theme/app_theme.dart';
import '../../core/utils/formatters.dart';

/// Colored status pill for document/job/extraction/ticket statuses.
class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final String status;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (fg, bg) = switch (status) {
      'completed' || 'done' || 'extracted' || 'active' || 'paid' || 'resolved' => (
          colors.brandLime,
          colors.brandLime.withValues(alpha: 0.14),
        ),
      'failed' || 'dead_letter' || 'suspended' || 'past_due' => (
          colors.destructive,
          colors.destructive.withValues(alpha: 0.12),
        ),
      'processing' || 'ocr' || 'ai_extraction' || 'validation' || 'queued' || 'pending' || 'open' => (
          colors.brandBlue,
          colors.brandBlue.withValues(alpha: 0.12),
        ),
      _ => (colors.mutedForeground, colors.surface2),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Text(
        titleCase(status),
        style: TextStyle(color: fg, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }
}
