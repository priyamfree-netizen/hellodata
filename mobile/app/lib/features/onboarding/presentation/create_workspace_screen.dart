import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../core/repositories.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets/brand_logo.dart';

/// Phase 2 — first workspace creation. Calls the `create_first_organization`
/// RPC (applies the free-plan grant), then re-resolves the session so the
/// router advances to `ready`.
class CreateWorkspaceScreen extends ConsumerStatefulWidget {
  const CreateWorkspaceScreen({super.key});

  @override
  ConsumerState<CreateWorkspaceScreen> createState() => _CreateWorkspaceScreenState();
}

class _CreateWorkspaceScreenState extends ConsumerState<CreateWorkspaceScreen> {
  final _name = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter a workspace name');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(orgRepositoryProvider).createFirstOrganization(name);
      // Re-resolve membership → router advances to ready.
      await ref.read(sessionControllerProvider.notifier).resolveWorkspace();
    } catch (e) {
      setState(() => _error = 'Could not create workspace: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final email = ref.watch(sessionControllerProvider).email;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: BrandLogo(fontSize: 30)),
                  const SizedBox(height: 24),
                  Icon(Icons.workspaces_outline, size: 44, color: colors.brandBlue),
                  const SizedBox(height: 16),
                  Text('Create your workspace',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 8),
                  Text(
                    'Signed in as ${email ?? ''}. Name your workspace to get started.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: colors.mutedForeground),
                  ),
                  const SizedBox(height: 28),
                  if (_error != null) ...[
                    Text(_error!, style: TextStyle(color: colors.destructive)),
                    const SizedBox(height: 12),
                  ],
                  TextField(
                    controller: _name,
                    decoration: const InputDecoration(
                        labelText: 'Workspace name', hintText: 'Acme Inc.'),
                    textCapitalization: TextCapitalization.words,
                    onSubmitted: (_) => _create(),
                  ),
                  const SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: _busy ? null : _create,
                    child: _busy
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : const Text('Create workspace'),
                  ),
                  TextButton(
                    onPressed: () =>
                        ref.read(sessionControllerProvider.notifier).logout(),
                    child: const Text('Sign out'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
