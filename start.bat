@echo off
echo 正在启动思维导图AI聊天应用...
echo.
echo 检查Python环境...
python --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到Python，请先安装Python 3.9+
    pause
    exit /b 1
)

echo 检查依赖...
pip show fastapi >nul 2>&1
if errorlevel 1 (
    echo 正在安装依赖...
    pip install -r requirements.txt
)

echo.
echo 启动应用...
echo 应用地址: http://localhost:8000/app
echo API文档: http://localhost:8000/docs
echo.
python main.py
pause
