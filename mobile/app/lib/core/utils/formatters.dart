import 'package:intl/intl.dart';

String formatBytes(int bytes) {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var size = bytes.toDouble();
  var unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  final str = size >= 100 || size == size.roundToDouble()
      ? size.toStringAsFixed(0)
      : size.toStringAsFixed(1);
  return '$str ${units[unit]}';
}

String formatDate(DateTime? d) {
  if (d == null) return '—';
  return DateFormat('d MMM y').format(d.toLocal());
}

String formatDateTime(DateTime? d) {
  if (d == null) return '—';
  return DateFormat('d MMM y, h:mm a').format(d.toLocal());
}

String formatRelative(DateTime? d) {
  if (d == null) return '—';
  final diff = DateTime.now().difference(d.toLocal());
  if (diff.inSeconds < 60) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 7) return '${diff.inDays}d ago';
  return formatDate(d);
}

String formatInr(double? amount) {
  if (amount == null) return '—';
  return NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0)
      .format(amount);
}

String titleCase(String s) =>
    s.isEmpty ? s : s[0].toUpperCase() + s.substring(1).replaceAll('_', ' ');
