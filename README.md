# Tools Nectra Digital

A comprehensive, automated PDF and Image workspace built with Django. Ready for production.

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies: `pip install -r requirements.txt`
3. Run migrations: `python manage.py migrate`
4. Run server: `python manage.py runserver`

## Deployment (Render)

- **Start Command**: `gunicorn toolsai.wsgi:application`
- **Build Command**: `./build.sh` (make sure we add execution permissions if needed, or just `bash build.sh`)
- Enable standard Django environment variables.
