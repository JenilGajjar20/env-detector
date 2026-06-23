const FLAG_DEFINITIONS = [
  { name: "ask", long: "--ask", short: "-a" },
  { name: "compare", long: "--compare", short: "-c" },
  { name: "check", long: "--check", short: "-k" },
  { name: "fix", long: "--fix", short: "-f" },
  { name: "fromBackup", long: "--from-backup", takesValue: true },
  { name: "security", long: "--security", short: "-s" },
  { name: "strict", long: "--strict", short: "-t" },
  { name: "version", long: "--version", short: "-v" },
  { name: "help", long: "--help", short: "-h" }
];

function parseArgs(args) {
  const options = {};
  const validFlags = new Set();

  FLAG_DEFINITIONS.forEach(definition => {
    validFlags.add(definition.long);
    if (definition.short) {
      validFlags.add(definition.short);
    }

    options[definition.name] = hasFlag(args, definition);

    if (definition.takesValue) {
      options[`${definition.name}Value`] = getFlagValue(args, definition.long);
    }
  });

  return {
    options,
    unknownFlag: findUnknownFlag(args, FLAG_DEFINITIONS, validFlags)
  };
}

function hasFlag(args, definition) {
  return args.includes(definition.long) ||
    args.some(arg => definition.takesValue && arg.startsWith(`${definition.long}=`)) ||
    (definition.short ? args.includes(definition.short) : false);
}

function getFlagValue(args, longFlag) {
  const equalsArg = args.find(arg => arg.startsWith(`${longFlag}=`));
  if (equalsArg) {
    return equalsArg.slice(longFlag.length + 1);
  }

  const index = args.indexOf(longFlag);
  if (index === -1) return null;

  const value = args[index + 1];
  if (!value || value.startsWith("-")) return null;

  return value;
}

function findUnknownFlag(args, definitions, validFlags) {
  return args.find((arg, index) => {
    if (!arg.startsWith("-")) return false;

    const valueOwner = definitions.find(definition =>
      definition.takesValue &&
      args[index - 1] === definition.long
    );

    if (valueOwner) return false;

    const valueFlag = definitions.find(definition =>
      definition.takesValue &&
      arg.startsWith(`${definition.long}=`)
    );

    if (valueFlag) return false;

    return !validFlags.has(arg);
  });
}

module.exports = {
  FLAG_DEFINITIONS,
  parseArgs
};
