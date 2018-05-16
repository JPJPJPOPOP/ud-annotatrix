#!/bin/bash

# colors
GREEN="\033[1;32m"
RESET="\033[0m"

alias echo="echo -e"
alias runserver="python3 server/server.py"

# python virtual environment setup
VENV=""
if hash virtualenv 2>/dev/null; then
  VENV="ud-env"

  if [ ! -d $VENV ]; then
    virtualenv --no-site-packages $VENV --python=python3.6
  fi
  . ./$VENV/bin/activate

  # virtual environment use instructions
  echo ""
  echo "NOTE: Python virtual environment activated ($GREEN$VENV$RESET);"
  echo "  to deactivate, type ${GREEN}$ deactivate${RESET}."
  echo ""

fi

# install required python packages
# without "Requirement already satisfied warnings"
pip3 install -r requirements.txt 1> >(grep -v 'Requirement already satisfied' 1>&2)

# fix matplotlib compatibility in virtualenv
echo "backend : TkAgg" > ~/.matplotlib/matplotlibrc

# basic ENV file
ENV=.env
if [ ! -f $ENV ]; then
  echo "VIRTUAL_ENV=$VENV" >> $ENV
  echo "PATH_TO_CORPORA=corpora" >> $ENV
  echo "SECRET_KEY=annotatrixareforkids" >> $ENV
  echo "HOST=127.0.0.1" >> $ENV
  echo "PORT=5316" >> $ENV
  echo "DEBUG=DEBUG" >> $ENV
fi
