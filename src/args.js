function createArgParser(args, validFlags) {
  function hasFlag(longFlag, shortFlag) {
    return args.includes(longFlag) ||
      args.some(arg => arg.startsWith(`${longFlag}=`)) ||
      (shortFlag ? args.includes(shortFlag) : false);
  }

  function getFlagValue(flag) {
    const equalsArg = args.find(arg => arg.startsWith(`${flag}=`));
    if (equalsArg) {
      return equalsArg.slice(flag.length + 1);
    }

    const index = args.indexOf(flag);
    if (index === -1) return null;

    const value = args[index + 1];
    if (!value || value.startsWith("-")) return null;

    return value;
  }

  function findUnknownFlag() {
    return args.find(arg => {
      if (!arg.startsWith("-")) return false;
      if (arg.startsWith("--from-backup=")) return false;
      return !validFlags.includes(arg);
    });
  }

  return {
    findUnknownFlag,
    getFlagValue,
    hasFlag
  };
}

module.exports = {
  createArgParser
};
