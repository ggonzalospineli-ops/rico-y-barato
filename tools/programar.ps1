# Crea (o reemplaza) la tarea programada que corre tools\publicar.ps1 todos los días a las 12:30.
#   powershell -ExecutionPolicy Bypass -File tools\programar.ps1
# Para sacarla:  schtasks /Delete /TN "Rico y Barato - actualizar" /F

$script = Join-Path $PSScriptRoot 'publicar.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At '12:30'
# Si la compu estaba apagada a esa hora, corre cuando se prende. Con batería también.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName 'Rico y Barato - actualizar' -Action $action -Trigger $trigger -Settings $settings -Description 'Baja precios, horarios y fotos de Rappi y publica Rico y Barato' -Force | Out-Null
Get-ScheduledTask -TaskName 'Rico y Barato - actualizar' | Select-Object TaskName, State, @{n='Proxima';e={(Get-ScheduledTaskInfo $_).NextRunTime}}
