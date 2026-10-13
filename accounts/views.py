from django.contrib.auth.decorators import login_required
from django.shortcuts import render


@login_required
def home(request):
    """Stage A authenticated entry; no project or task functionality yet."""
    return render(request, "accounts/home.html")
