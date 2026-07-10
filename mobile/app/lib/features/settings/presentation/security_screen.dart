import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import 'settings_screen.dart';

/// Password change + 2FA status. Full 2FA enrollment (TOTP QR / email OTP) is a
/// planned increment; here we surface status and the change-password flow.
class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key});

  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _saving = false;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _change() async {
    if (_next.text.length < 8) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('New password must be at least 8 characters')));
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(accountRepositoryProvider).changePassword(_current.text, _next.text);
      if (mounted) {
        _current.clear();
        _next.clear();
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Password changed')));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileProvider);
    final colors = context.colors;

    return Scaffold(
      appBar: AppBar(title: const Text('Password & security')),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: ListTile(
              leading: Icon(Icons.shield_outlined, color: colors.brandBlue),
              title: const Text('Two-factor authentication'),
              subtitle: Text(profile.maybeWhen(
                data: (p) => (p?.twoFactorEnabled ?? false)
                    ? 'Enabled'
                    : 'Not enabled — manage on the web app',
                orElse: () => '…',
              )),
              trailing: profile.maybeWhen(
                data: (p) => Icon(
                  (p?.twoFactorEnabled ?? false) ? Icons.check_circle : Icons.circle_outlined,
                  color: (p?.twoFactorEnabled ?? false)
                      ? colors.brandLime
                      : colors.mutedForeground,
                ),
                orElse: () => const SizedBox.shrink(),
              ),
            ),
          ),
          const SizedBox(height: 24),
          Text('Change password', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TextField(
            controller: _current,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'Current password'),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _next,
            obscureText: true,
            decoration: const InputDecoration(labelText: 'New password'),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _saving ? null : _change,
            child: _saving
                ? const SizedBox(
                    width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Update password'),
          ),
        ],
      ),
    );
  }
}
