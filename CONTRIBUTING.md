# Contributing to OpenHaul Protocol

Thank you for your interest in contributing to OpenHaul Protocol! This document provides guidelines for contributing to the project.

## Code of Conduct

This project adheres to a standard code of conduct. By participating, you are expected to uphold this code:
- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
- Respect different viewpoints and experiences

## How to Contribute

### Reporting Bugs

Before creating a bug report, please:
1. Check if the issue already exists
2. Use the latest version
3. Collect relevant information (logs, environment, steps to reproduce)

**Bug report template:**
```markdown
**Description:**
Clear description of the bug

**Steps to Reproduce:**
1. Step one
2. Step two
3. ...

**Expected Behavior:**
What you expected to happen

**Actual Behavior:**
What actually happened

**Environment:**
- Network: (e.g., Polygon Mumbai, Mainnet)
- Contract Version: 
- Tools: (e.g., Hardhat, Foundry)
```

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. Please:
1. Use a clear, descriptive title
2. Provide detailed description
3. Explain why this enhancement would be useful
4. List possible implementation approaches

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**PR Requirements:**
- All tests must pass
- Code must be formatted with `forge fmt` or equivalent
- Include relevant test cases
- Update documentation if needed
- Reference related issues

## Development Setup

### Prerequisites
- Node.js >= 18
- Hardhat
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/openhaul-protocol/contracts.git
cd contracts

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your configuration

# Compile contracts
npx hardhat compile

# Run tests
npx hardhat test

# Deploy locally
npx hardhat run scripts/deploy.js --network localhost
```

### Testing

```bash
# Run all tests
npx hardhat test

# Run specific test file
npx hardhat test test/OrderContract.test.js

# Run with gas reporting
REPORT_GAS=true npx hardhat test

# Run with coverage
npx hardhat coverage
```

## Coding Standards

### Solidity
- Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- Use NatSpec comments for all public functions
- Maximum line length: 120 characters
- Use explicit function visibility
- Include revert reasons for all requires

### JavaScript
- Follow [StandardJS](https://standardjs.com/) style
- Use async/await over callbacks
- Include JSDoc comments for functions

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

**Examples:**
```
feat(OrderContract): add batch order creation
fix(ReputationContract): prevent score overflow
docs(architecture): update dispute flow diagram
test(DisputeContract): add appeal scenario tests
```

## Security

If you discover a security vulnerability, please:
1. **DO NOT** open a public issue
2. Email security@openhaul.xyz with details
3. Allow time for remediation before disclosure

## Smart Contract Guidelines

### Before Submitting
- [ ] Run Slither static analysis
- [ ] Run Mythril symbolic execution
- [ ] All tests pass with >90% coverage
- [ ] Gas optimization considered
- [ ] Reentrancy guards in place
- [ ] Access controls verified

### Audit Checklist
- [ ] No integer overflow/underflow
- [ ] No reentrancy vulnerabilities
- [ ] Proper access control
- [ ] Events emitted for state changes
- [ ] Input validation complete
- [ ] Economic incentives aligned

## Documentation

- Update `docs/architecture.md` for structural changes
- Update inline NatSpec for function changes
- Add examples for new features
- Update deployment guides if needed

## Community

- Discord: [https://discord.gg/openhaul](https://discord.gg/openhaul)
- Forum: [https://forum.openhaul.xyz](https://forum.openhaul.xyz)
- Twitter: [@OpenHaulProtocol](https://twitter.com/OpenHaulProtocol)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
