#!/bin/bash
DISPLAY=:6 python3 -c "import PIL.ImageGrab as g;g.grab(xdisplay=':6').save('/workspace/kaoyan/user-test/round9/$1.png')" && echo ok $1
