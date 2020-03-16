#!/bin/bash

IS_CI="${CI:-false}"
GREP_PATTERN=$1

if [ "$IS_CI" = true ]; then
  git fetch origin
  git merge --no-edit origin/master

  if [ $? -ne 0 ]; then
    echo "Branch has conflicts with master, failing test."
    exit 1
  fi
fi

FILES_COUNT="$(git diff-tree --no-commit-id --name-only -r "$CIRCLE_BRANCH" origin/master | grep -E "$GREP_PATTERN" -c)"

if [ "$FILES_COUNT" -eq 0 ]; then
  echo "0 files matching '$GREP_PATTERN'; exiting and marking successful."
  circleci step halt || exit 1
else
  echo "$FILES_COUNT file(s) matching '$GREP_PATTERN'; continuing."
fi
