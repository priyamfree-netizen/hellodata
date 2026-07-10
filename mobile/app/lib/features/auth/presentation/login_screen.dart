import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/network/api_exception.dart';
import '../../../core/providers.dart';
import '../../../core/theme/app_theme.dart';
import '../../../shared/widgets/brand_logo.dart';
import '../data/auth_api.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();

  bool _busy = false;
  bool _obscure = true;
  String? _error;

  // MFA challenge state (set when the server asks for a second factor).
  LoginMfaRequired? _mfa;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _submitPassword() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = ref.read(authApiProvider);
      final result = await auth.login(_email.text.trim(), _password.text);
      switch (result) {
        case LoginOk(:final accessToken):
          await ref
              .read(sessionControllerProvider.notifier)
              .onAuthenticated(accessToken);
        case LoginMfaRequired():
          setState(() => _mfa = result);
      }
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Something went wrong. Please try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submitCode() async {
    final mfa = _mfa;
    if (mfa == null) return;
    if (_code.text.trim().length < 6) {
      setState(() => _error = 'Enter the 6-digit code');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final auth = ref.read(authApiProvider);
      final token = await auth.verifyMfaChallenge(mfa.challengeToken, _code.text.trim());
      await ref.read(sessionControllerProvider.notifier).onAuthenticated(token);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = 'Verification failed. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resendCode() async {
    final mfa = _mfa;
    if (mfa == null) return;
    try {
      await ref.read(authApiProvider).resendMfaChallengeCode(mfa.challengeToken);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Code resent')));
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final isMfa = _mfa != null;

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 440),
              child: Form(
                key: _formKey,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Center(child: BrandLogo(fontSize: 32)),
                    const SizedBox(height: 8),
                    Center(
                      child: Text(
                        isMfa ? 'Two-factor verification' : 'Sign in to your account',
                        style: TextStyle(color: colors.mutedForeground),
                      ),
                    ),
                    const SizedBox(height: 32),
                    if (_error != null) _ErrorBanner(_error!),
                    if (_error != null) const SizedBox(height: 16),
                    if (!isMfa) ..._passwordFields() else ..._mfaFields(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _passwordFields() {
    return [
      TextFormField(
        controller: _email,
        keyboardType: TextInputType.emailAddress,
        autofillHints: const [AutofillHints.email],
        textInputAction: TextInputAction.next,
        decoration: const InputDecoration(labelText: 'Email'),
        validator: (v) =>
            (v == null || !v.contains('@')) ? 'Enter a valid email' : null,
      ),
      const SizedBox(height: 16),
      TextFormField(
        controller: _password,
        obscureText: _obscure,
        autofillHints: const [AutofillHints.password],
        textInputAction: TextInputAction.done,
        onFieldSubmitted: (_) => _submitPassword(),
        decoration: InputDecoration(
          labelText: 'Password',
          suffixIcon: IconButton(
            icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
            onPressed: () => setState(() => _obscure = !_obscure),
          ),
        ),
        validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
      ),
      Align(
        alignment: Alignment.centerRight,
        child: TextButton(
          onPressed: _busy ? null : () => context.push('/forgot'),
          child: const Text('Forgot password?'),
        ),
      ),
      const SizedBox(height: 8),
      ElevatedButton(
        onPressed: _busy ? null : _submitPassword,
        child: _busy ? const _BtnSpinner() : const Text('Sign in'),
      ),
      const SizedBox(height: 16),
      Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text("Don't have an account?",
              style: TextStyle(color: context.colors.mutedForeground)),
          TextButton(
            onPressed: _busy ? null : () => context.push('/signup'),
            child: const Text('Sign up'),
          ),
        ],
      ),
    ];
  }

  List<Widget> _mfaFields() {
    final method = _mfa!.method;
    return [
      Text(
        method == 'email'
            ? 'Enter the 6-digit code sent to your email.'
            : 'Enter the 6-digit code from your authenticator app.',
        style: TextStyle(color: context.colors.mutedForeground),
      ),
      const SizedBox(height: 16),
      TextFormField(
        controller: _code,
        keyboardType: TextInputType.number,
        maxLength: 6,
        textAlign: TextAlign.center,
        style: const TextStyle(fontSize: 24, letterSpacing: 8),
        decoration: const InputDecoration(counterText: '', hintText: '••••••'),
        onFieldSubmitted: (_) => _submitCode(),
      ),
      const SizedBox(height: 8),
      ElevatedButton(
        onPressed: _busy ? null : _submitCode,
        child: _busy ? const _BtnSpinner() : const Text('Verify'),
      ),
      const SizedBox(height: 8),
      if (method == 'email')
        TextButton(onPressed: _busy ? null : _resendCode, child: const Text('Resend code')),
      TextButton(
        onPressed: _busy ? null : () => setState(() => _mfa = null),
        child: const Text('Back to sign in'),
      ),
    ];
  }

}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner(this.message);
  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.destructive.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.destructive.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, size: 18, color: colors.destructive),
          const SizedBox(width: 8),
          Expanded(child: Text(message, style: TextStyle(color: colors.destructive))),
        ],
      ),
    );
  }
}

class _BtnSpinner extends StatelessWidget {
  const _BtnSpinner();
  @override
  Widget build(BuildContext context) => const SizedBox(
        width: 20,
        height: 20,
        child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
      );
}
